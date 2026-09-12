export const SECONDS_PER_DAY = 86400;
export const NEW_HIRE_HOLD_SECONDS = 72 * 3600;
export const SCHEMA_VERSION = 1;
export const DEFAULT_SETTINGS = Object.freeze({
  inactivityDays: 1,
  newHireHoldHours: 72,
  maxAddiction: 3,
  prioritizeNeverTrained: true,
  rotationMode: "fair",
  fairnessWindowDays: 30,
  accrueDebtWhileIneligible: false,
  removalThresholdDays: null,
  notificationMode: "important",
  showGlobalBadge: true,
  showTrainCount: true,
  showNativeTrainingBadges: true,
  compactDensity: false,
  reduceMotion: false,
  refreshMinutes: 5
});
