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

  const lastDueDateObj = new Date(lastDueDate);

  switch (frequency) {
    case "Daily":
      // A daily record is created and due the day after the last record's due date
      const nextDay = new Date(lastDueDateObj);
      nextDay.setDate(lastDueDateObj.getDate() + 1);
      return today.getDate() === nextDay.getDate() &&
        today.getMonth() === nextDay.getMonth() &&
        today.getFullYear() === nextDay.getFullYear()
        ? formatApiDate(nextDay)
        : null;

    case "Weekly":
      // A weekly record is created on a Sunday and due the following Saturday
      const nextWeek = new Date(lastDueDateObj);
      nextWeek.setDate(lastDueDateObj.getDate() + 7);
      const creationDateWeekly = new Date(nextWeek);
      creationDateWeekly.setDate(nextWeek.getDate() - 1); // The day before the new due date

      if (
        today.getFullYear() === creationDateWeekly.getFullYear() &&
        today.getMonth() === creationDateWeekly.getMonth() &&
        today.getDate() === creationDateWeekly.getDate()
      ) {
        const nextSaturday = new Date(creationDateWeekly);
        nextSaturday.setDate(creationDateWeekly.getDate() + 6);
        return formatApiDate(nextSaturday);
      }
      break;

    case "Monthly":
      // A monthly record is created on the 1st of the month and due at the end of that month
      const nextMonth = new Date(lastDueDateObj);
      nextMonth.setMonth(lastDueDateObj.getMonth() + 1);
      const creationDateMonthly = new Date(nextMonth);
      creationDateMonthly.setDate(1);

      if (
        today.getFullYear() === creationDateMonthly.getFullYear() &&
        today.getMonth() === creationDateMonthly.getMonth() &&
        today.getDate() === creationDateMonthly.getDate()
      ) {
        const endOfNewMonth = new Date(
          creationDateMonthly.getFullYear(),
          creationDateMonthly.getMonth() + 1,
          0
        );
        return formatApiDate(endOfNewMonth);
      }
      break;

    case "Quarterly":
      // A quarterly record is created 7 days before the start of the next quarter, and due at the end of that month
      const nextQuarter = new Date(lastDueDateObj);
      nextQuarter.setMonth(lastDueDateObj.getMonth() + 3);
      const creationDateQuarterly = new Date(
        nextQuarter.getFullYear(),
        nextQuarter.getMonth(),
        1
      );
      creationDateQuarterly.setDate(creationDateQuarterly.getDate() - 7);

      if (
        today.getFullYear() === creationDateQuarterly.getFullYear() &&
        today.getMonth() === creationDateQuarterly.getMonth() &&
        today.getDate() === creationDateQuarterly.getDate()
      ) {
        const endOfNewMonth = new Date(
          nextQuarter.getFullYear(),
          nextQuarter.getMonth() + 1,
          0
        );
        return formatApiDate(endOfNewMonth);
      }
      break;

    case "Biannually":
      // A biannual record is created on the 1st of the month, 5 months after the last due date
      const nextBiannual = new Date(lastDueDateObj);
      nextBiannual.setMonth(lastDueDateObj.getMonth() + 5);
      const creationDateBiannual = new Date(
        nextBiannual.getFullYear(),
        nextBiannual.getMonth(),
        1
      );

      if (
        today.getFullYear() === creationDateBiannual.getFullYear() &&
        today.getMonth() === creationDateBiannual.getMonth() &&
        today.getDate() === creationDateBiannual.getDate()
      ) {
        const endOfNextMonth = new Date(
          nextBiannual.getFullYear(),
          nextBiannual.getMonth() + 2,
          0
        );
        return formatApiDate(endOfNextMonth);
      }
      break;

    case "Annually":
      // An annual record is created on the 1st of the month, 1 month before the next due date, and due 1 year from the last due date
      const nextAnnual = new Date(lastDueDateObj);
      nextAnnual.setFullYear(lastDueDateObj.getFullYear() + 1);
      const creationDateAnnual = new Date(
        nextAnnual.getFullYear(),
        nextAnnual.getMonth() - 1,
        1
      );

      if (
        today.getFullYear() === creationDateAnnual.getFullYear() &&
        today.getMonth() === creationDateAnnual.getMonth() &&
        today.getDate() === creationDateAnnual.getDate()
      ) {
        return formatApiDate(nextAnnual);
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
