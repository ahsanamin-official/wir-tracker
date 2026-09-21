/* ===========================================================
   validation.js — data validation utilities
   =========================================================== */

const Validate = {
  required(val) { return val !== undefined && val !== null && String(val).trim() !== ''; },
  isNumber(val) { return val !== '' && val !== null && !isNaN(parseFloat(val)); },
  nonNegative(val) { return this.isNumber(val) && parseFloat(val) >= 0; },
  isDate(val) { return this.required(val) && !isNaN(new Date(val).getTime()); },
  dateRangeValid(start, end) { return this.isDate(start) && this.isDate(end) && new Date(end) >= new Date(start); },

  /** Validate the "New Weekly Report" step-1 form fields */
  validateReportInfo(fields) {
    const errors = {};
    if (!this.required(fields.reportNumber)) errors.reportNumber = 'Report number is required.';
    if (!this.required(fields.weekLabel)) errors.weekLabel = 'Reporting week label is required.';
    if (!this.isDate(fields.startDate)) errors.startDate = 'A valid start date is required.';
    if (!this.isDate(fields.endDate)) errors.endDate = 'A valid end date is required.';
    if (this.isDate(fields.startDate) && this.isDate(fields.endDate) && !this.dateRangeValid(fields.startDate, fields.endDate)) {
      errors.endDate = 'End date must be on or after the start date.';
    }
    return errors;
  },

  async checkDuplicateReportNumber(reportNumber, excludeId = null) {
    const reports = await storage.getReports();
    return reports.some(r => r.reportNumber.trim().toLowerCase() === reportNumber.trim().toLowerCase() && r.id !== excludeId);
  },

  validateDailyRecord(rec) {
    const errors = {};
    if (!this.isDate(rec.date)) errors.date = 'Date is required.';
    if (!this.required(rec.dailyReportId)) errors.dailyReportId = 'Daily report ID is required.';
    if (!this.required(rec.siteStatus)) errors.siteStatus = 'Site status is required.';
    if (rec.siteStatus === 'Closed' && !this.required(rec.closureReason)) errors.closureReason = 'Closure reason is required when site is closed.';
    return errors;
  },

  validateActivity(act) {
    const errors = {};
    if (!this.required(act.structuralElement)) errors.structuralElement = 'Select a structural element.';
    if (!this.required(act.activityCategory)) errors.activityCategory = 'Select an activity category.';
    if (!this.required(act.activityDescription)) errors.activityDescription = 'Description is required.';
    if (!this.required(act.unit)) errors.unit = 'Unit is required.';
    if (act.quantity !== '' && act.quantity !== null && act.quantity !== undefined && !this.nonNegative(act.quantity)) {
      errors.quantity = 'Quantity cannot be negative.';
    }
    ['length', 'width', 'height'].forEach(k => {
      if (act[k] !== '' && act[k] !== null && act[k] !== undefined && !this.nonNegative(act[k])) {
        errors[k] = 'Must be a non-negative number.';
      }
    });
    return errors;
  },

  hasErrors(errObj) { return Object.keys(errObj).length > 0; }
};
