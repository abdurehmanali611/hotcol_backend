/**
 * Unit tests for hrApprovalEngine (no DB).
 * Run: node scripts/test-hr-approval-engine.mjs
 */
import {
  defaultSteps,
  effectiveSteps,
  nextIndexAfterEmptyAssignees,
  normalizeSteps,
  pickFlow,
} from "../hrApprovalEngine.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

assert(
  normalizeSteps([{ kind: "hr" }, { kind: "nope" }, "manager"]).length === 2,
  "normalizeSteps filters invalid",
);

const withTeam = effectiveSteps(
  {
    requireTeamLeaderFirst: true,
    stepsJson: [
      { kind: "team_leader" },
      { kind: "department_leader" },
      { kind: "manager" },
    ],
  },
  { hasTeam: true },
);
assert(withTeam[0].kind === "team_leader", "keeps team_leader when has team");

const noTeam = effectiveSteps(
  {
    requireTeamLeaderFirst: true,
    stepsJson: [
      { kind: "team_leader" },
      { kind: "department_leader" },
      { kind: "manager" },
    ],
  },
  { hasTeam: false },
);
assert(noTeam[0].kind === "department_leader", "strips team_leader without team");

const skipToggle = effectiveSteps(
  {
    requireTeamLeaderFirst: false,
    stepsJson: [{ kind: "team_leader" }, { kind: "manager" }],
  },
  { hasTeam: true },
);
assert(skipToggle[0].kind === "manager", "requireTeamLeaderFirst false strips");

const flows = [
  {
    requestType: "leave",
    departmentId: null,
    active: true,
    stepsJson: [{ kind: "manager" }],
  },
  {
    requestType: "leave",
    departmentId: 5,
    active: true,
    stepsJson: [{ kind: "hr" }],
  },
];
assert(pickFlow(flows, { requestType: "leave", departmentId: 5 }).departmentId === 5, "dept override");
assert(pickFlow(flows, { requestType: "leave", departmentId: 9 }).departmentId == null, "default");

assert(defaultSteps({ businessType: "Hotel" })[0].kind === "department_leader", "lodging");
assert(defaultSteps({ businessType: "Cafe and Restaurant", hrSoloManagerEnabled: false })[0].kind === "admin", "cafe admin");
assert(
  defaultSteps({ businessType: "Cafe and Restaurant", hrSoloManagerEnabled: true }).map((s) => s.kind).join(",") ===
    "hr,admin",
  "cafe solo hr",
);

const esc = nextIndexAfterEmptyAssignees(
  [{ kind: "team_leader" }, { kind: "department_leader" }, { kind: "manager" }],
  0,
  [
    { employeeIds: [], roles: [] },
    { employeeIds: [], roles: [] },
    { employeeIds: [], roles: ["Manager"] },
  ],
);
assert(esc.nextIndex === 2 && esc.escalatedKinds.length === 2, "escalate empty leaders");

const allEmpty = nextIndexAfterEmptyAssignees(
  [{ kind: "department_leader" }],
  0,
  [{ employeeIds: [], roles: [] }],
);
assert(allEmpty.final === true, "all empty final");

console.log("hrApprovalEngine: PASS");
