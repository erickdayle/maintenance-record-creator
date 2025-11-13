import "dotenv/config";
import {
  searchMaintenanceRecords,
  getRecordMetadata,
  createMaintenanceRecord,
} from "./services/ace-api.js";

// Helper function to get the parent ID from available fields
const getParentId = (attributes) => {
  return (
    attributes.cf_parent_record ||
    attributes.cf_parent_equipment_record_new ||
    attributes.parent_id ||
    null
  );
};

function filterMostRecentRecords(records) {
  const groups = new Map();

  for (const record of records) {
    const parentId = getParentId(record.attributes);
    const frequency = record.attributes.cf_maintenance_frequency_dropdown;
    // *** UPDATED LOGIC ***
    // Get the new completion date
    const completionDate = record.attributes.cf_pm_completion_date;

    // *** UPDATED FILTER ***
    // Only group records that have a valid frequency AND a completion date
    if (frequency && frequency.toLowerCase() !== "none" && completionDate) {
      const groupKey = `${parentId}-${frequency}`;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }
      groups.get(groupKey).push(record);
    }
  }

  const mostRecentRecords = [];

  for (const group of groups.values()) {
    // This logic remains the same: find the most recently created record in the group
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

// *** UPDATED FUNCTION ***
// Changed 'lastDueDate' to 'lastCompletionDate' for clarity
function getNextDueDate(frequency, lastCompletionDate) {
  // Use the current date for production runs
  const today = new Date();

  // FOR TESTING:
  // const today = new Date("2025-12-25T00:00:00Z");

  today.setUTCHours(0, 0, 0, 0);

  const formatApiDate = (date) => {
    return date.toISOString().slice(0, 19) + "+00:00";
  };

  // *** UPDATED LOGIC ***
  // All calculations are now based on the completion date
  const completionDateObj = new Date(lastCompletionDate);

  switch (frequency) {
    case "Daily":
      const nextDay = new Date(completionDateObj);
      nextDay.setUTCDate(completionDateObj.getUTCDate() + 1);

      if (
        today.getUTCDate() === nextDay.getUTCDate() &&
        today.getUTCMonth() === nextDay.getUTCMonth() &&
        today.getUTCFullYear() === nextDay.getUTCFullYear()
      ) {
        return formatApiDate(nextDay);
      }
      break;

    case "Weekly":
      const nextSunday = new Date(completionDateObj);
      nextSunday.setUTCDate(completionDateObj.getUTCDate() + 1);

      while (nextSunday.getUTCDay() !== 0) {
        nextSunday.setUTCDate(nextSunday.getUTCDate() + 1);
      }

      if (
        today.getUTCFullYear() === nextSunday.getUTCFullYear() &&
        today.getUTCMonth() === nextSunday.getUTCMonth() &&
        today.getUTCDate() === nextSunday.getUTCDate()
      ) {
        const nextSaturday = new Date(nextSunday);
        nextSaturday.setUTCDate(nextSunday.getUTCDate() + 6);
        return formatApiDate(nextSaturday);
      }
      break;

    case "Monthly":
      const nextMonthDue = new Date(completionDateObj);
      nextMonthDue.setUTCMonth(completionDateObj.getUTCMonth() + 1);
      const creationDateMonthly = new Date(nextMonthDue);
      creationDateMonthly.setUTCDate(1);

      if (
        today.getUTCFullYear() === creationDateMonthly.getUTCFullYear() &&
        today.getUTCMonth() === creationDateMonthly.getUTCMonth() &&
        today.getUTCDate() === creationDateMonthly.getUTCDate()
      ) {
        const endOfNewMonth = new Date(
          Date.UTC(
            creationDateMonthly.getUTCFullYear(),
            creationDateMonthly.getUTCMonth() + 1,
            0
          )
        );
        return formatApiDate(endOfNewMonth);
      }
      break;

    case "Quarterly":
      const quarterlyDueDate = new Date(completionDateObj);
      quarterlyDueDate.setUTCMonth(completionDateObj.getUTCMonth() + 3);
      const creationDateQuarterly = new Date(
        Date.UTC(
          quarterlyDueDate.getUTCFullYear(),
          quarterlyDueDate.getUTCMonth(),
          1
        )
      );
      creationDateQuarterly.setUTCDate(creationDateQuarterly.getUTCDate() - 7);

      if (
        today.getUTCFullYear() === creationDateQuarterly.getUTCFullYear() &&
        today.getUTCMonth() === creationDateQuarterly.getUTCMonth() &&
        today.getUTCDate() === creationDateQuarterly.getUTCDate()
      ) {
        const endOfNewMonth = new Date(
          Date.UTC(
            quarterlyDueDate.getUTCFullYear(),
            quarterlyDueDate.getUTCMonth() + 1,
            0
          )
        );
        return formatApiDate(endOfNewMonth);
      }
      break;

    // Corrected the typo to match your data
    case "Biannually":
    case "Bi-Annually":
      const nextBiannualDue = new Date(completionDateObj);
      nextBiannualDue.setUTCMonth(completionDateObj.getUTCMonth() + 5);
      const creationDateBiannual = new Date(nextBiannualDue);
      creationDateBiannual.setUTCDate(1);

      if (
        today.getUTCFullYear() === creationDateBiannual.getUTCFullYear() &&
        today.getUTCMonth() === creationDateBiannual.getUTCMonth() &&
        today.getUTCDate() === creationDateBiannual.getUTCDate()
      ) {
        return formatApiDate(nextBiannualDue);
      }
      break;

    case "Annually":
      const nextAnnual = new Date(completionDateObj);
      nextAnnual.setUTCFullYear(completionDateObj.getUTCFullYear() + 1);
      const creationDateAnnual = new Date(
        Date.UTC(nextAnnual.getUTCFullYear(), nextAnnual.getUTCMonth() - 1, 1)
      );

      if (
        today.getUTCFullYear() === creationDateAnnual.getUTCFullYear() &&
        today.getUTCMonth() === creationDateAnnual.getUTCMonth() &&
        today.getUTCDate() === creationDateAnnual.getUTCDate()
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

    // *** UPDATED VALIDITY FILTER ***
    const validRecords = allRecords.filter((record) => {
      const attr = record.attributes;
      const hasParentId =
        attr.cf_parent_record || attr.cf_parent_equipment_record_new;
      return (
        hasParentId &&
        attr.cf_maintenance_frequency_dropdown &&
        attr.date_created &&
        // Now checks for the completion date
        attr.cf_pm_completion_date
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

      // *** UPDATED LOGIC ***
      // Get the completion date to be used for calculation
      const lastCompletionDate = summaryRecord.attributes.cf_pm_completion_date;

      // Pass the completion date to the calculation function
      const nextDueDate = getNextDueDate(frequency, lastCompletionDate);

      if (nextDueDate) {
        console.log(
          `✅ Condition met for record ${recordId} (Freq: ${frequency}). Fetching details...`
        );

        const fullRecord = await getRecordMetadata(recordId);
        const attributes = fullRecord.attributes;

        const definitiveParentId =
          fullRecord.relationships.parent?.data?.id ||
          attributes.cf_parent_record ||
          attributes.cf_parent_equipment_record_new ||
          summaryRecord.attributes.parent_id;

        const payload = {
          data: {
            type: "records",
            attributes: {
              type: parseInt(process.env.MAINTENANCE_RECORD_TYPE_ID),
              project_id: fullRecord.relationships.project?.data?.id || null,
              status_id: parseInt(process.env.INITIAL_STATUS_ID),
              parent_id: definitiveParentId,

              // Copy all relevant fields from the previous record
              cf_parent_record: attributes.cf_parent_record,
              cf_parent_equipment_record_new:
                attributes.cf_parent_equipment_record_new,
              cf_gmp_classification: attributes.cf_gmp_classification,
              cf_metro_equipment_manufactur:
                attributes.cf_metro_equipment_manufactur,
              cf_equipment_model: attributes.cf_equipment_model,
              cf_equip_serial_num: attributes.cf_equip_serial_num,
              cf_pm_type: attributes.cf_pm_type,
              cf_maintenance_frequency_dropdown: frequency,

              // Set the new due date
              cf_next_pm_due_date: nextDueDate,
              // We don't set cf_pm_completion_date, as it's a new record
            },
          },
        };

        const newRecord = await createMaintenanceRecord(payload);
        console.log(
          `🎉 Successfully created new record with ID: ${newRecord.data.id}`
        );
      } else {
        // This log can be useful for regular runs, so it's kept
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
