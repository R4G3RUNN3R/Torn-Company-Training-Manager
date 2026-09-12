import test from "node:test";
import assert from "node:assert/strict";
import { isJobCompanyArea, isCompanyEmployeesPage } from "../src/main.js";

function win(url) { return { location: new URL(url) }; }
const doc = { getElementById() { return null; }, querySelector() { return null; } };

test("Training Manager is available throughout Torn company area", () => {
  assert.equal(isJobCompanyArea(win("https://www.torn.com/companies.php?step=your"), doc), true);
  assert.equal(isJobCompanyArea(win("https://www.torn.com/companies.php?step=your#employees"), doc), true);
  assert.equal(isJobCompanyArea(win("https://www.torn.com/companies.php?step=your#company-profile"), doc), true);
  assert.equal(isJobCompanyArea(win("https://www.torn.com/companies.php?step=your&type=1#positions"), doc), true);
});

test("current Torn Job Company routes without legacy step=your still mount the manager", () => {
  assert.equal(isJobCompanyArea(win("https://www.torn.com/companies.php"), doc), true);
  assert.equal(isJobCompanyArea(win("https://www.torn.com/companies.php#/option=employees"), doc), true);
  assert.equal(isJobCompanyArea(win("https://www.torn.com/companies.php#/option=positions"), doc), true);
});

test("Job/company launcher does not claim unrelated Torn pages", () => {
  assert.equal(isJobCompanyArea(win("https://www.torn.com/index.php"), doc), false);
  assert.equal(isJobCompanyArea(win("https://www.torn.com/profiles.php?XID=123"), doc), false);
  assert.equal(isJobCompanyArea(win("https://www.torn.com/companies.php?step=profile&type=1"), doc), false);
});

test("Employees detector remains narrower than the overall Job Company area", () => {
  assert.equal(isJobCompanyArea(win("https://www.torn.com/companies.php?step=your#positions"), doc), true);
  assert.equal(isCompanyEmployeesPage(win("https://www.torn.com/companies.php?step=your#positions"), doc), false);
  assert.equal(isCompanyEmployeesPage(win("https://www.torn.com/companies.php?step=your#employees"), doc), true);
  assert.equal(isCompanyEmployeesPage(win("https://www.torn.com/companies.php#/option=employees"), doc), true);
  assert.equal(isCompanyEmployeesPage(win("https://www.torn.com/companies.php#/option=positions"), doc), false);
});