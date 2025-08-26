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

function getNextDueDate(frequency) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  switch (frequency) {
    case "Daily":
      return new Date().toISOString();

    case "Weekly":
      if (today.getDay() === 0) {
        const nextSaturday = new Date(today);
        nextSaturday.setDate(today.getDate() + 6);
        return nextSaturday.toISOString();
      }
      break;

    case "Monthly":
      if (today.getDate() === 1) {
        const endOfMonth = new Date(
          today.getFullYear(),
          today.getMonth() + 1,
          0
        );
        return endOfMonth.toISOString();
      }
      break;

    case "Quarterly":
      if (today.getDate() === 1 && today.getMonth() % 3 === 0) {
        const endOfCurrentMonth = new Date(
          today.getFullYear(),
          today.getMonth() + 1,
          0
        );
        return endOfCurrentMonth.toISOString();
      }
      break;

    case "Biannually":
      if (today.getDate() === 1 && today.getMonth() % 6 === 0) {
        const endOfNextMonth = new Date(
          today.getFullYear(),
          today.getMonth() + 2,
          0
        );
        return endOfNextMonth.toISOString();
      }
      break;

    case "Annually":
      if (today.getDate() === 1 && today.getMonth() === 0) {
        const endOfMarch = new Date(today.getFullYear(), 3, 0);
        return endOfMarch.toISOString();
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
        attr.date_created
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

      const nextDueDate = getNextDueDate(frequency);

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
