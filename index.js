import "dotenv/config";
import {
  searchMaintenanceRecords,
  getRecordMetadata,
  createMaintenanceRecord,
} from "./services/ace-api.js";

function filterMostRecentRecords(records) {
  const groups = new Map();

  for (const record of records) {
    const parentId = record.attributes.cf_parent_record;
    const frequency = record.attributes.cf_maintenance_frequency_dropdown;
    const groupKey = `${parentId}-${frequency}`;

    if (!groups.has(groupKey)) {
      groups.set(groupKey, []);
    }
    groups.get(groupKey).push(record);
  }

  const mostRecentRecords = [];

  for (const group of groups.values()) {
    const mostRecent = group.reduce((latest, current) => {
      return new Date(current.attributes.date_created) >
        new Date(latest.attributes.date_created)
        ? current
        : latest;
    });
    mostRecentRecords.push(mostRecent);
  }

  return mostRecentRecords;
}

function getNextDueDate(frequency, lastDueDate) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const formatApiDate = (date) => {
    return date.toISOString().slice(0, 19) + "+00:00";
  };

  switch (frequency) {
    case "Daily":
      return formatApiDate(new Date());

    case "Weekly":
      if (today.getDay() === 0) {
        const nextSaturday = new Date(today);
        nextSaturday.setDate(today.getDate() + 6);
        return formatApiDate(nextSaturday);
      }
      break;

    case "Monthly":
      if (today.getDate() === 1) {
        const endOfMonth = new Date(
          today.getFullYear(),
          today.getMonth() + 1,
          0
        );
        return formatApiDate(endOfMonth);
      }
      break;

    case "Quarterly":
      const quarterlyDueDate = new Date(lastDueDate);
      quarterlyDueDate.setMonth(quarterlyDueDate.getMonth() + 3);
      const creationDateQuarterly = new Date(quarterlyDueDate);
      creationDateQuarterly.setDate(quarterlyDueDate.getDate() - 7);

      if (
        today.getFullYear() === creationDateQuarterly.getFullYear() &&
        today.getMonth() === creationDateQuarterly.getMonth() &&
        today.getDate() === creationDateQuarterly.getDate()
      ) {
        return formatApiDate(quarterlyDueDate);
      }
      break;

    case "Biannually":
      if (today.getDate() === 1 && today.getMonth() % 6 === 0) {
        const endOfNextMonth = new Date(
          today.getFullYear(),
          today.getMonth() + 2,
          0
        );
        return formatApiDate(endOfNextMonth);
      }
      break;

    case "Annually":
      const annualDueDate = new Date(lastDueDate);
      annualDueDate.setFullYear(annualDueDate.getFullYear() + 1);
      const creationDateAnnual = new Date(annualDueDate);
      creationDateAnnual.setMonth(annualDueDate.getMonth() - 1);
      creationDateAnnual.setDate(1);

      if (
        today.getFullYear() === creationDateAnnual.getFullYear() &&
        today.getMonth() === creationDateAnnual.getMonth() &&
        today.getDate() === creationDateAnnual.getDate()
      ) {
        return formatApiDate(annualDueDate);
      }
      break;
  }
  return null;
}

async function runMaintenanceJob() {
  console.log("🚀 Starting daily maintenance job...");
  try {
    const allRecords = await searchMaintenanceRecords();
    console.log(`Fetched ${allRecords.length} total maintenance records.`);

    const validRecords = allRecords.filter((record) => {
      const attr = record.attributes;
      return (
        attr.cf_parent_record &&
        attr.cf_maintenance_frequency_dropdown &&
        attr.date_created &&
        attr.cf_next_pm_due_date
      );
    });
    console.log(`Found ${validRecords.length} valid records after filtering.`);

    const recordsToProcess = filterMostRecentRecords(validRecords);
    console.log(
      `Processing ${recordsToProcess.length} unique Parent/Frequency groups.`
    );

    for (const summaryRecord of recordsToProcess) {
      const recordId = summaryRecord.id;
      const frequency =
        summaryRecord.attributes.cf_maintenance_frequency_dropdown;
      const lastDueDate = summaryRecord.attributes.cf_next_pm_due_date;

      const nextDueDate = getNextDueDate(frequency, lastDueDate);

      if (nextDueDate) {
        console.log(
          `✅ Condition met for record ${recordId} (Freq: ${frequency}). Fetching details...`
        );

        const fullRecord = await getRecordMetadata(recordId);
        const attributes = fullRecord.attributes;

        const payload = {
          data: {
            type: "records",
            attributes: {
              // System IDs required by the API
              type: parseInt(process.env.MAINTENANCE_RECORD_TYPE_ID),
              project_id: fullRecord.relationships.project?.data?.id || null,
              status_id: parseInt(process.env.INITIAL_STATUS_ID),

              // Use the 'parent' relationship if it exists, otherwise use 'cf_parent_record'
              parent_id: fullRecord.relationships.parent?.data?.id
                ? fullRecord.relationships.parent.data.id
                : attributes.cf_parent_record,

              // Custom fields copied from the previous record
              cf_parent_record: attributes.cf_parent_record,
              cf_gmp_classification: attributes.cf_gmp_classification,
              cf_metro_equipment_manufactur:
                attributes.cf_metro_equipment_manufactur,
              cf_equipment_model: attributes.cf_equipment_model,
              cf_equip_serial_num: attributes.cf_equip_serial_num,
              cf_pm_type: attributes.cf_pm_type,
              cf_maintenance_frequency_dropdown: frequency,
              cf_next_pm_due_date: nextDueDate,
            },
          },
        };

        const newRecord = await createMaintenanceRecord(payload);
        console.log(
          `🎉 Successfully created new record with ID: ${newRecord.data.id}`
        );
      } else {
        console.log(
          `- Skipping record ${recordId} (Freq: ${frequency}). Condition not met today.`
        );
      }
    }
  } catch (error) {
    console.error(
      "❌ An error occurred during the maintenance job:",
      error.message
    );
  } finally {
    console.log("✨ Maintenance job finished.");
  }
}

runMaintenanceJob();
