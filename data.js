/* ============================================================
   MMR Newsletter Analytics — OpenBI App
   REPRESENTATIVE SAMPLE DATA (not live figures).
   Shaped to the real semantic model: 5 MMR entities, CAD base,
   12 trailing months, all 20 report pages.
   Replace this module with live Fabric semantic-model queries to go production.
   ============================================================ */
window.MMR = (function () {
  const months = ["Aug '25","Sep '25","Oct '25","Nov '25","Dec '25","Jan '26",
                  "Feb '26","Mar '26","Apr '26","May '26","Jun '26","Jul '26"];
  const fiscalStartIndex = 1; // Sep '25 = first month of FY26

  // Revenue by entity, CAD millions (order = data-palette slot 1..5)
  const entities = [
    { key: "canada",    name: "MMR Canada",    ccy: "CAD", pyF: 0.90,
      rev: [1.02,0.98,1.10,1.05,1.14,1.08,1.20,1.16,1.24,1.19,1.28,1.31] },
    { key: "usa",       name: "MMR USA",       ccy: "USD", pyF: 0.88,
      rev: [0.72,0.70,0.78,0.75,0.80,0.77,0.84,0.82,0.88,0.85,0.90,0.93] },
    { key: "india",     name: "MMR India",     ccy: "INR", pyF: 0.84,
      rev: [0.30,0.29,0.33,0.32,0.35,0.34,0.37,0.36,0.39,0.38,0.41,0.43] },
    { key: "singapore", name: "MMR Singapore", ccy: "SGD", pyF: 0.87,
      rev: [0.24,0.23,0.26,0.25,0.27,0.27,0.29,0.28,0.31,0.30,0.32,0.33] },
    { key: "australia", name: "MMR Australia", ccy: "AUD", pyF: 0.85,
      rev: [0.20,0.19,0.22,0.21,0.23,0.23,0.25,0.24,0.26,0.26,0.28,0.29] },
  ];
  const entityByKey = Object.fromEntries(entities.map(e => [e.key, e]));

  const revPriorYear = [2.28,2.15,2.40,2.35,2.48,2.42,2.60,2.55,2.68,2.62,2.74,2.80];

  // Headcount / utilization
  const fte         = [151,153,150,155,158,157,160,162,159,164,166,168];
  const billability = [0.63,0.61,0.64,0.66,0.65,0.67,0.66,0.68,0.69,0.68,0.70,0.71];
  const HOURS_PER_FTE = 172;

  // ---- Resource Management (weekly billability) ----
  const weeks = ["8w","7w","6w","5w","4w","3w","Last wk","Current"];
  const resAllStaff   = [0.58,0.60,0.61,0.63,0.62,0.65,0.66,0.68];
  const resConsultants= [0.64,0.66,0.65,0.68,0.69,0.70,0.71,0.73];

  // People (Resource Mgmt / Week of Supply / Backlog / Hours Remaining anchor)
  const people = [
    { name: "Chen, Maya",       entity: "canada",    type: "Consultants",       bill: 0.82, budgeted: 640, duration: 210, remaining: 430 },
    { name: "Rodionov, Michael",entity: "canada",    type: "Operational Staff", bill: 0.71, budgeted: 520, duration: 300, remaining: 220 },
    { name: "Patel, Anika",     entity: "india",     type: "Consultants",       bill: 0.77, budgeted: 700, duration: 260, remaining: 440 },
    { name: "Nguyen, David",    entity: "usa",       type: "Consultants",       bill: 0.69, budgeted: 480, duration: 350, remaining: 130 },
    { name: "Silva, Rafael",    entity: "usa",       type: "Consultants",       bill: 0.74, budgeted: 560, duration: 300, remaining: 260 },
    { name: "Tan, Wei",         entity: "singapore", type: "Consultants",       bill: 0.66, budgeted: 420, duration: 280, remaining: 140 },
    { name: "Ortega, Sofia",    entity: "canada",    type: "Consultants",       bill: 0.79, budgeted: 600, duration: 240, remaining: 360 },
    { name: "Kim, Jae",         entity: "australia", type: "Consultants",       bill: 0.63, budgeted: 380, duration: 250, remaining: 130 },
    { name: "Bauer, Mira",      entity: "india",     type: "Operational Staff", bill: 0.58, budgeted: 340, duration: 260, remaining:  80 },
    { name: "Holm, Anders",     entity: "usa",       type: "Consultants",       bill: 0.72, budgeted: 520, duration: 300, remaining: 220 },
    { name: "Rivera, Sam",      entity: "canada",    type: "Consultants",       bill: 0.68, budgeted: 500, duration: 320, remaining: 180 },
    { name: "Noguchi, Taro",    entity: "singapore", type: "Consultants",       bill: 0.61, budgeted: 360, duration: 250, remaining: 110 },
  ];

  // Non-billable hours by category (Grouping Key), latest month
  const nonBillableByCategory = [
    { label: "Business Ops",      value: 3050 },
    { label: "Bench Time",        value: 1980 },
    { label: "Business Dev",      value: 1540 },
    { label: "Internal Projects", value:  980 },
    { label: "HR",                value:  520 },
    { label: "Training",          value:  310 },
  ];
  const billabilityByEntity = [
    { key: "canada",    name: "MMR Canada",    value: 0.73 },
    { key: "usa",       name: "MMR USA",       value: 0.70 },
    { key: "india",     name: "MMR India",     value: 0.68 },
    { key: "singapore", name: "MMR Singapore", value: 0.66 },
    { key: "australia", name: "MMR Australia", value: 0.64 },
  ];

  // ---- Client Revenue / Top N (latest-month revenue by client, CAD millions) ----
  const clientRevenue = [
    { client: "Kneat Solutions",        entity: "canada",    rev: 0.62 },
    { client: "Allyant Inc.",           entity: "usa",       rev: 0.41 },
    { client: "Novel Biotechnology",    entity: "usa",       rev: 0.34 },
    { client: "Cascade Life Sciences",  entity: "canada",    rev: 0.30 },
    { client: "Meridian Pharma",        entity: "canada",    rev: 0.26 },
    { client: "Ingenica Pharma",        entity: "india",     rev: 0.22 },
    { client: "Polaris Diagnostics",    entity: "singapore", rev: 0.19 },
    { client: "Sanova Biotech",         entity: "australia", rev: 0.16 },
    { client: "Vertex Clinical",        entity: "usa",       rev: 0.14 },
    { client: "Helix Labs",             entity: "india",     rev: 0.12 },
    { client: "Aurora Bio",             entity: "canada",    rev: 0.11 },
    { client: "Coastal Pharma",         entity: "singapore", rev: 0.09 },
    { client: "Beacon Therapeutics",    entity: "australia", rev: 0.08 },
    { client: "Summit Diagnostics",     entity: "usa",       rev: 0.07 },
    { client: "Other clients",          entity: "canada",    rev: 0.18 },
  ];

  // ---- Hours Remaining (drill: user > client > project > task) ----
  const hoursRemaining = [
    { user: "Chen, Maya",    client: "Kneat Solutions",     project: "Validation 2026",  task: "IQ/OQ Authoring",   remaining: 180 },
    { user: "Chen, Maya",    client: "Kneat Solutions",     project: "Validation 2026",  task: "PQ Execution",      remaining: 120 },
    { user: "Chen, Maya",    client: "Cascade Life Sciences",project: "CSV Remediation", task: "Gap Assessment",    remaining: 90  },
    { user: "Patel, Anika",  client: "Ingenica Pharma",     project: "Data Integrity",   task: "Audit Trail Review",remaining: 160 },
    { user: "Patel, Anika",  client: "Helix Labs",          project: "MES Rollout",      task: "URS Authoring",     remaining: 110 },
    { user: "Ortega, Sofia", client: "Meridian Pharma",     project: "Annual Product Review", task: "Trending",     remaining: 140 },
    { user: "Silva, Rafael", client: "Allyant Inc.",        project: "Accessibility Audit", task: "WCAG Testing",   remaining: 130 },
    { user: "Silva, Rafael", client: "Novel Biotechnology", project: "Method Transfer",  task: "Protocol Draft",    remaining: 100 },
    { user: "Nguyen, David", client: "Vertex Clinical",     project: "eTMF Migration",   task: "Mapping",           remaining: 70  },
    { user: "Tan, Wei",      client: "Polaris Diagnostics", project: "ISO 13485",        task: "QMS Update",        remaining: 120 },
    { user: "Kim, Jae",      client: "Sanova Biotech",      project: "GMP Readiness",    task: "SOP Authoring",     remaining: 95  },
    { user: "Holm, Anders",  client: "Summit Diagnostics",  project: "CAPA Program",     task: "Root Cause",        remaining: 85  },
  ];

  // ---- FX Rates (Bank of Canada — units of foreign currency per 1 CAD, monthly avg) ----
  const fxRates = [
    { to: "USD", values: [0.735,0.732,0.729,0.731,0.728,0.726,0.724,0.727,0.730,0.729,0.731,0.730] },
    { to: "INR", values: [61.2,61.0,60.5,60.8,60.4,60.1,59.8,60.2,60.6,60.4,60.7,60.5] },
    { to: "SGD", values: [0.985,0.982,0.979,0.981,0.978,0.976,0.974,0.977,0.980,0.979,0.981,0.980] },
    { to: "AUD", values: [1.098,1.101,1.104,1.100,1.103,1.106,1.108,1.104,1.101,1.103,1.099,1.100] },
  ];

  // ---- Credit Notes ----
  const creditNotes = [
    { tenant: "MMR Consulting Canada", entity:"canada",    date: "12 Jun 2026", number: "CN-2041", contact: "Kneat Solutions",    status: "PAID", ccy: "CAD", subtotal: 0.042 },
    { tenant: "MMR Consulting US",     entity:"usa",       date: "03 Jun 2026", number: "CN-2039", contact: "Allyant Inc.",       status: "PAID", ccy: "USD", subtotal: 0.031 },
    { tenant: "MMR Consulting India",  entity:"india",     date: "28 May 2026", number: "CN-2035", contact: "Ingenica Pharma",    status: "PAID", ccy: "INR", subtotal: 0.018 },
    { tenant: "MMR Consulting Canada", entity:"canada",    date: "21 May 2026", number: "CN-2033", contact: "Meridian Pharma",    status: "PAID", ccy: "CAD", subtotal: 0.026 },
    { tenant: "MMR Consulting US",     entity:"usa",       date: "14 May 2026", number: "CN-2030", contact: "Novel Biotechnology",status: "PAID", ccy: "USD", subtotal: 0.022 },
    { tenant: "MMR Consulting SG Pte.",entity:"singapore", date: "06 May 2026", number: "CN-2028", contact: "Polaris Diagnostics",status: "PAID", ccy: "SGD", subtotal: 0.015 },
    { tenant: "MMR Consulting Canada", entity:"canada",    date: "24 Apr 2026", number: "CN-2025", contact: "Cascade Life Sciences",status:"PAID",ccy:"CAD", subtotal: 0.019 },
    { tenant: "MMR Consulting AUS",    entity:"australia", date: "17 Apr 2026", number: "CN-2022", contact: "Sanova Biotech",     status: "PAID", ccy: "AUD", subtotal: 0.012 },
    { tenant: "MMR Consulting US",     entity:"usa",       date: "09 Apr 2026", number: "CN-2019", contact: "Vertex Clinical",    status: "PAID", ccy: "USD", subtotal: 0.028 },
    { tenant: "MMR Consulting India",  entity:"india",     date: "31 Mar 2026", number: "CN-2016", contact: "Helix Labs",         status: "PAID", ccy: "INR", subtotal: 0.014 },
    { tenant: "MMR Consulting Canada", entity:"canada",    date: "20 Mar 2026", number: "CN-2013", contact: "Aurora Bio",         status: "PAID", ccy: "CAD", subtotal: 0.017 },
    { tenant: "MMR Consulting SG Pte.",entity:"singapore", date: "11 Mar 2026", number: "CN-2011", contact: "Coastal Pharma",     status: "PAID", ccy: "SGD", subtotal: 0.009 },
  ]; // subtotal in CAD millions

  // ---- Accounts Receivable ----
  const arBuckets = [
    { label: "Not Overdue",  value: 3.90 },
    { label: "1–30 days",    value: 1.45 },
    { label: "31–60 days",   value: 0.72 },
    { label: "61–90 days",   value: 0.43 },
    { label: "91–120 days",  value: 0.26 },
    { label: "> 120 days",   value: 0.34 },
  ]; // CAD millions

  const arClients = [ // CAD thousands, tagged by entity
    { name: "Kneat Solutions",       entity:"canada",    notOverdue: 980, d30: 360, d60: 180, d90: 90,  d120: 60, over120: 80 },
    { name: "Allyant Inc.",          entity:"usa",       notOverdue: 410, d30: 150, d60: 70,  d90: 40,  d120: 20, over120: 30 },
    { name: "Novel Biotechnology",   entity:"usa",       notOverdue: 360, d30: 120, d60: 60,  d90: 35,  d120: 20, over120: 45 },
    { name: "Cascade Life Sciences", entity:"canada",    notOverdue: 300, d30: 110, d60: 50,  d90: 30,  d120: 15, over120: 25 },
    { name: "Meridian Pharma",       entity:"canada",    notOverdue: 260, d30: 90,  d60: 45,  d90: 25,  d120: 15, over120: 20 },
    { name: "Ingenica Pharma",       entity:"india",     notOverdue: 220, d30: 80,  d60: 40,  d90: 20,  d120: 12, over120: 18 },
    { name: "Polaris Diagnostics",   entity:"singapore", notOverdue: 190, d30: 70,  d60: 35,  d90: 18,  d120: 10, over120: 15 },
    { name: "Sanova Biotech",        entity:"australia", notOverdue: 160, d30: 60,  d60: 30,  d90: 15,  d120: 8,  over120: 12 },
    { name: "Vertex Clinical",       entity:"usa",       notOverdue: 140, d30: 55,  d60: 25,  d90: 14,  d120: 7,  over120: 10 },
    { name: "Other clients",         entity:"canada",    notOverdue: 880, d30: 355, d60: 185, d90: 143, d120: 93, over120: 75 },
  ];

  const arTotal    = [5.8,6.1,5.9,6.4,6.6,6.3,6.8,6.7,7.0,6.9,7.2,7.1];
  const arOverdue  = [2.4,2.6,2.5,2.8,2.9,2.7,3.0,3.0,3.2,3.1,3.3,3.2];
  const arInventory= [3.1,3.2,3.0,3.3,3.4,3.2,3.5,3.5,3.7,3.6,3.8,3.9]; // unbilled inventory, CAD millions

  // ---- Working Capital / Balance Sheet, CAD millions ----
  const cash               = [4.2,4.3,4.1,4.5,4.6,4.4,4.7,4.8,4.9,4.8,5.0,5.1];
  const currentAssets      = [12.1,12.3,12.0,12.6,12.8,12.5,13.0,13.1,13.4,13.3,13.7,13.9];
  const currentLiabilities = [6.3,6.4,6.2,6.5,6.6,6.4,6.7,6.7,6.9,6.8,7.0,7.0];
  const equity             = [9.2,9.3,9.1,9.5,9.7,9.5,9.9,10.0,10.2,10.1,10.4,10.6];
  const wcByEntity = [
    { key:"canada",    name: "MMR Canada",    value: 5.6 },
    { key:"usa",       name: "MMR USA",       value: 3.8 },
    { key:"india",     name: "MMR India",     value: 1.1 },
    { key:"singapore", name: "MMR Singapore", value: 0.9 },
    { key:"australia", name: "MMR Australia", value: 0.6 },
  ];

  // ---- Backlog (months of backlog per user × last 6 months) ----
  const backlogMonths = months.slice(6);
  const backlogUsers = [
    { user: "Chen, Maya",     v: [3.1,3.4,3.0,3.6,3.8,4.1] },
    { user: "Patel, Anika",   v: [2.8,3.0,2.9,3.2,3.4,3.6] },
    { user: "Ortega, Sofia",  v: [2.4,2.6,2.5,2.8,2.9,3.1] },
    { user: "Silva, Rafael",  v: [1.9,2.1,2.0,2.3,2.4,2.6] },
    { user: "Holm, Anders",   v: [1.6,1.7,1.6,1.9,2.0,2.2] },
    { user: "Tan, Wei",       v: [1.2,1.3,1.4,1.5,1.6,1.8] },
    { user: "Kim, Jae",       v: [0.9,1.0,1.1,1.2,1.3,1.4] },
    { user: "Nguyen, David",  v: [0.7,0.8,0.9,1.0,1.1,1.2] },
  ];

  // ---- Unassigned Hours (projects with unallocated remaining work) ----
  // po/exp/hrBudget in CAD millions; unassignedValue derived; hours via blended rate
  const unassignedProjects = [
    { project: "Kneat · Validation 2026",       entity:"canada",    po: 1.80, exp: 0.12, hrBudget: 0.90 },
    { project: "Ingenica · Data Integrity",     entity:"india",     po: 0.95, exp: 0.06, hrBudget: 0.52 },
    { project: "Allyant · Accessibility Audit", entity:"usa",       po: 0.80, exp: 0.05, hrBudget: 0.48 },
    { project: "Meridian · Annual Review",      entity:"canada",    po: 0.65, exp: 0.04, hrBudget: 0.40 },
    { project: "Polaris · ISO 13485",           entity:"singapore", po: 0.55, exp: 0.03, hrBudget: 0.34 },
    { project: "Sanova · GMP Readiness",        entity:"australia", po: 0.48, exp: 0.03, hrBudget: 0.30 },
    { project: "Helix · MES Rollout",           entity:"india",     po: 0.42, exp: 0.02, hrBudget: 0.27 },
    { project: "Vertex · eTMF Migration",       entity:"usa",       po: 0.38, exp: 0.02, hrBudget: 0.25 },
  ];
  const unassignedMonthly = [2.9,3.1,3.0,3.3,3.5,3.4,3.6,3.7,3.9,3.8,4.0,4.2]; // unassigned $ CAD millions
  const blendedRateCAD = 130; // CAD/hour blended (for $ → hours)

  const currencies = {
    "CAD": { factor: 1,     symbol: "C$" },
    "USD": { factor: 0.73,  symbol: "US$" },
    "INR": { factor: 60.5,  symbol: "₹" },
    "SGD": { factor: 0.98,  symbol: "S$" },
    "AUD": { factor: 1.10,  symbol: "A$" },
  };

  return {
    months, fiscalStartIndex, entities, entityByKey, revPriorYear, fte, billability, HOURS_PER_FTE,
    weeks, resAllStaff, resConsultants, people,
    nonBillableByCategory, billabilityByEntity,
    clientRevenue, hoursRemaining, fxRates, creditNotes,
    arBuckets, arClients, arTotal, arOverdue, arInventory,
    cash, currentAssets, currentLiabilities, equity, wcByEntity,
    backlogMonths, backlogUsers, unassignedProjects, unassignedMonthly, blendedRateCAD,
    currencies, refreshed: "13 Jul 2026 · 08:00",
  };
})();
