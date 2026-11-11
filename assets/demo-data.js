/* Fictional sample organisation for demo mode. No real staff data lives in this repository:
 * real people are loaded into the private Google Sheet by the Apps Script backend. */
var DemoData = (function () {
  'use strict';
  function build(todayStr) {
    var D = function (n) { return Core.addDays(todayStr, n); };
    var T = function (n, h) { var d = new Date(Core.addDays(todayStr, n) + 'T00:00:00'); d.setHours(h || 10); return d.toISOString(); };
    var P = function (id, name, designation, grade, entity, level, managerId, homeTeamId, roles, extra) {
      return Object.assign({ id: id, name: name, designation: designation, grade: grade, entity: entity, level: String(level), managerId: managerId || '', verifierId: '', homeTeamId: homeTeamId || '', roles: roles || '', phone: '+9190000' + id.slice(1).padStart(5, '0'), email: '', lang: level >= 5 ? 'kn' : 'en', status: 'active', leaveFrom: '', leaveUntil: '', coverId: '', notes: '' }, extra || {});
    };
    var people = [
      P('P001', 'Asha Menon', 'Trustee', '', 'Shared', 0, '', 'tm_lead', 'owner'),
      P('P002', 'Rahul Shenoy', 'Trustee', '', 'Shared', 0, '', 'tm_lead', 'owner'),
      P('P003', 'Kavitha Rao', 'Principal', 'T5', 'College', 1, 'P001', 'tm_lead', 'owner'),
      P('P004', 'Meera Pai', 'School Administrator', 'A3', 'School', 1, 'P002', 'tm_lead', 'owner'),
      P('P005', 'Suresh Bhat', 'Academic Coordinator', '', 'College', 1, 'P001', 'tm_lead', 'owner'),
      P('P006', 'Nisha Kamath', 'Administrator, Academics', 'A3', 'College', 2, 'P003', 'tm_acadadmin', 'admin,sysadmin'),
      P('P007', 'Deepak Shetty', 'Administrator, Operations', 'A3', 'College', 2, 'P003', 'tm_ops', 'admin'),
      P('P008', 'Imran Sheikh', 'Senior Lecturer, Physics', 'T4', 'College', 3, 'P006', 'tm_phy'),
      P('P009', 'Latha Nayak', 'Lecturer, Physics', 'T3', 'College', 4, 'P006', 'tm_phy', '', { verifierId: 'P008' }),
      P('P010', 'Varun Hegde', 'Assistant Lecturer, Physics', 'T2', 'College', 4, 'P006', 'tm_phy', '', { verifierId: 'P008' }),
      P('P011', 'Fathima Ali', 'Senior Lecturer, Chemistry', 'T4', 'College', 3, 'P006', 'tm_chem'),
      P('P012', 'Ganesh Prabhu', 'Lecturer, Chemistry', 'T3', 'College', 4, 'P006', 'tm_chem', '', { verifierId: 'P011' }),
      P('P013', 'Priya Kini', 'Junior Lecturer, Chemistry', 'T1', 'College', 4, 'P006', 'tm_chem', '', { verifierId: 'P011' }),
      P('P014', 'Sanjay Acharya', 'Senior Lecturer, Maths', 'T4', 'College', 3, 'P006', 'tm_maths'),
      P('P015', 'Rekha Bangera', 'Lecturer, Maths', 'T3', 'College', 4, 'P006', 'tm_maths'),
      P('P016', 'Anil Poojary', 'Associate Administrator, Physics AA', 'A2', 'College', 3, 'P006', 'tm_acadadmin', 'admin'),
      P('P017', 'Divya Salian', 'Associate Administrator, Chemistry AA', 'A2', 'College', 3, 'P006', 'tm_acadadmin', 'admin'),
      P('P018', 'Joel Fernandes', 'Administrator, Front Desk', 'A3', 'College', 2, 'P003', 'tm_front', 'admin'),
      P('P019', 'Sneha Rai', 'Admin Assistant, Front Desk', 'A1', 'College', 4, 'P018', 'tm_front'),
      P('P020', 'Ramesh Gowda', 'Warden', 'SUPW', 'College', 5, 'P007', 'tm_ops'),
      P('P021', 'Shobha Naik', 'Housekeeping', 'SUP', 'College', 5, 'P007', 'tm_ops'),
      P('P022', 'Manju Kotian', 'Maintenance', 'SUP', 'College', 5, 'P007', 'tm_ops'),
      P('P023', 'Anitha Lobo', 'Senior Coordinator, Primary', 'L4', 'School', 2, 'P004', 'tm_primary'),
      P('P024', 'Kiran Moily', 'Primary Teacher', 'T3', 'School', 4, 'P004', 'tm_primary', '', { verifierId: 'P023' }),
      P('P025', 'Pooja Suvarna', 'Primary Teacher', 'T2', 'School', 4, 'P004', 'tm_primary', '', { verifierId: 'P023' }),
      P('P026', 'Grace Pinto', 'Montessori Guide', 'T3', 'School', 4, 'P004', 'tm_kg'),
      P('P027', 'Uma Bhandary', 'Associate Montessori Guide', 'T2', 'School', 4, 'P004', 'tm_kg'),
      P('P028', 'Victor Saldanha', 'Café Manager', 'CAFM', 'Shared', 2, 'P002', 'tm_cafe'),
      P('P029', 'Lokesh Amin', 'Café Staff', 'CAF', 'Shared', 5, 'P028', 'tm_cafe'),
      P('P030', 'Savitha Kumari', 'Café Staff', 'CAF', 'Shared', 5, 'P028', 'tm_cafe'),
      P('P031', 'Neil Mascarenhas', 'Marketing / IT', 'MKT', 'Shared', 4, 'P002', 'tm_mkt'),
      P('P032', 'Tanvi Shet', 'Admin Officer', 'A2', 'School', 3, 'P004', 'tm_schooladmin', 'admin')
    ];
    var FN = { tm_lead: 'Leadership', tm_acadadmin: 'Administration', tm_front: 'Administration', tm_schooladmin: 'Administration', tm_ops: 'Operations', tm_cafe: 'Café', tm_mkt: 'Marketing, IT and finance' };
    var Tm = function (id, name, entity, type, leadId, adminIds, extra) { return Object.assign({ id: id, name: name, entity: entity, 'function': FN[id] || 'Academics', type: type, leadId: leadId, deputyId: '', adminIds: adminIds || '', endDate: '', initiativeId: '', active: 'true' }, extra || {}); };
    var teams = [
      Tm('tm_lead', 'Leadership', 'Shared', 'home', 'P001'),
      Tm('tm_acadadmin', 'Academic administration', 'College', 'home', 'P006', 'P006'),
      Tm('tm_phy', 'Physics', 'College', 'home', 'P008', 'P016'),
      Tm('tm_chem', 'Chemistry', 'College', 'home', 'P011', 'P017'),
      Tm('tm_maths', 'Maths', 'College', 'home', 'P014', 'P016'),
      Tm('tm_front', 'Front desk', 'College', 'home', 'P018', 'P018'),
      Tm('tm_ops', 'Operations, hostel and housekeeping', 'College', 'home', 'P007', 'P007'),
      Tm('tm_primary', 'Primary', 'School', 'home', 'P023', 'P032'),
      Tm('tm_kg', 'Kindergarten and Montessori', 'School', 'home', 'P023', 'P032', { deputyId: 'P026' }),
      Tm('tm_schooladmin', 'School admin office', 'School', 'home', 'P004', 'P032'),
      Tm('tm_cafe', 'Café', 'Shared', 'home', 'P028', 'P028'),
      Tm('tm_mkt', 'Marketing and IT', 'Shared', 'home', 'P002'),
      Tm('tm_fete', 'Makers Fête', 'Shared', 'project', 'P005', 'P016', { endDate: D(40), initiativeId: 'in_fete' })
    ];
    var memberships = [
      { id: 'mb1', teamId: 'tm_fete', personId: 'P009', role: 'member' },
      { id: 'mb2', teamId: 'tm_fete', personId: 'P012', role: 'member' },
      { id: 'mb3', teamId: 'tm_fete', personId: 'P031', role: 'member' },
      { id: 'mb4', teamId: 'tm_fete', personId: 'P024', role: 'member' }
    ];
    var priorities = [
      { id: 'pr1', title: 'Stronger board and entrance results in senior science', term: 'Term 2', ownerId: 'P005', active: 'true' },
      { id: 'pr2', title: 'More hands-on, inquiry-based learning', term: 'Term 2', ownerId: 'P003', active: 'true' },
      { id: 'pr3', title: 'Grow admissions for next year', term: 'Term 2', ownerId: 'P002', active: 'true' },
      { id: 'pr4', title: 'A smoother, leaner campus', term: 'Term 2', ownerId: 'P001', active: 'true' }
    ];
    var initiatives = [
      { id: 'in_dpp', title: 'Practice problem bank', priorityId: 'pr1', ownerId: 'P008', goal: '200 graded problems per subject', endDate: D(60), status: 'active' },
      { id: 'in_tests', title: 'Cumulative test series', priorityId: 'pr1', ownerId: 'P005', goal: '4 tests with analysis in 48 hours', endDate: D(60), status: 'active' },
      { id: 'in_inquiry', title: 'Inquiry-based lessons', priorityId: 'pr2', ownerId: 'P023', goal: 'One inquiry unit per class', endDate: D(60), status: 'active' },
      { id: 'in_fete', title: 'Makers Fête as open day', priorityId: 'pr3', ownerId: 'P005', goal: '150 prospective families visit', endDate: D(40), status: 'active' },
      { id: 'in_paperless', title: 'Paperless admin processes', priorityId: 'pr4', ownerId: 'P007', goal: 'Leave, stores and complaints online', endDate: D(60), status: 'active' }
    ];
    var n = 0;
    var I = function (o) {
      n++;
      return Object.assign({ id: 'it_demo' + n, kind: 'task', title: '', notes: '', assigneeId: '', teamId: '', createdBy: '', createdAt: T(-10), updatedAt: T(-1), initiativeId: '', due: '', dueTime: '', status: 'open', band: '', collaborators: '', evidence: '', evidenceType: '', verifierId: '', verifiedBy: '', verifiedAt: '', completedAt: '', disputeReason: '', returnNote: '', helpReason: '', helpAt: '', helpAckBy: '', helpAckAt: '', helpStep: '', helpResolution: '', overdueStep: '', dutyId: '', thanks: '' }, o);
    };
    var items = [
      I({ kind: 'contribution', title: 'Wrote 12 practice problems on electrostatics', assigneeId: 'P009', createdBy: 'P009', initiativeId: 'in_dpp', band: '1-3', status: 'verified', evidence: 'https://drive.google.com/demo-dpp-042', evidenceType: 'link', verifierId: 'P008', verifiedBy: 'P008', verifiedAt: T(-5), completedAt: T(-6), updatedAt: T(-5), thanks: 'Imran Sheikh: Lovely set, using it in all sections.' }),
      I({ kind: 'task', title: 'Co-design Cumulative Test 2 (Physics)', assigneeId: 'P009', createdBy: 'P016', collaborators: 'P010', initiativeId: 'in_tests', due: D(3), band: '3-6', status: 'open' }),
      I({ kind: 'task', title: 'Prepare seating plan for the mock entrance test', assigneeId: 'P010', createdBy: 'P016', due: D(1), status: 'confirm', updatedAt: T(-3) }),
      I({ kind: 'task', title: 'Plan activity stations and material list', assigneeId: 'P012', createdBy: 'P005', teamId: 'tm_fete', initiativeId: 'in_fete', due: D(-2), band: '1-3', status: 'blocked', helpReason: 'Need resources: no budget approved for materials yet', helpAt: T(-1, 11), helpStep: '1' }),
      I({ kind: 'task', title: 'Fix water leak, 3rd floor washroom', assigneeId: 'P022', createdBy: 'P007', due: D(0), status: 'review', evidence: 'photo: leak-fixed.jpg', evidenceType: 'photo', verifierId: 'P007', completedAt: T(0, 9), band: '1-3' }),
      I({ kind: 'task', title: 'Clean and restock the chemistry lab store', assigneeId: 'P021', createdBy: 'P007', due: D(-1), status: 'disputed', disputeReason: 'Not mine: lab store is handled by the lab assistant', updatedAt: T(-4) }),
      I({ kind: 'contribution', title: 'Rebuilt the photosynthesis unit as an inquiry lab', assigneeId: 'P024', createdBy: 'P024', initiativeId: 'in_inquiry', band: '6+', status: 'review', evidence: 'https://drive.google.com/demo-inquiry-unit', evidenceType: 'link', verifierId: 'P023', completedAt: T(-9), updatedAt: T(-9) }),
      I({ kind: 'contribution', title: 'Filmed student project reels for the open day', assigneeId: 'P031', createdBy: 'P031', initiativeId: 'in_fete', band: '3-6', status: 'verified', evidence: 'https://drive.google.com/demo-reels', evidenceType: 'link', verifierId: 'P002', verifiedBy: 'P002', verifiedAt: T(-2), completedAt: T(-3), updatedAt: T(-2) }),
      I({ kind: 'task', title: 'Move staff leave requests to an online form', assigneeId: 'P007', createdBy: 'P003', initiativeId: 'in_paperless', due: D(5), band: '3-6', status: 'open' }),
      I({ kind: 'task', title: 'Call 6 parents with fees overdue over 30 days', assigneeId: 'P019', createdBy: 'P018', due: D(-4), status: 'open', updatedAt: T(-6) }),
      I({ kind: 'task', title: 'Order new café menu boards', assigneeId: '', teamId: 'tm_cafe', createdBy: 'P028', due: D(4), status: 'open' }),
      I({ kind: 'help', title: 'Too much on my plate: three classes covered this week', assigneeId: 'P013', createdBy: 'P013', status: 'blocked', helpReason: 'Too much on my plate: covering three classes this week', helpAt: T(0, 9), helpStep: '0' }),
      I({ kind: 'task', title: 'Send weekly menu and feedback summary', assigneeId: 'P029', createdBy: 'P028', due: D(2), status: 'open', band: '<1' }),
      I({ kind: 'task', title: 'Replaced 14 corridor tube lights', assigneeId: 'P022', createdBy: 'P007', band: '3-6', status: 'verified', evidence: 'photo: corridor-lights.jpg', evidenceType: 'photo', verifierId: 'P007', verifiedBy: 'P007', verifiedAt: T(-2), completedAt: T(-3), updatedAt: T(-2), thanks: 'Deepak Shetty: Quick work before the parents\' meeting, thank you.' }),
      I({ kind: 'contribution', title: 'Ran a phonics game session for parents', assigneeId: 'P025', createdBy: 'P025', initiativeId: 'in_inquiry', band: '1-3', status: 'verified', evidence: 'https://drive.google.com/demo-phonics', evidenceType: 'link', verifierId: 'P023', verifiedBy: 'P023', verifiedAt: T(-1), completedAt: T(-2), updatedAt: T(-1) }),
      I({ kind: 'task', title: 'Collected fees from 18 families after reminders', assigneeId: 'P019', createdBy: 'P018', band: '3-6', status: 'verified', evidence: 'https://docs.google.com/demo-fee-sheet', evidenceType: 'link', verifierId: 'P018', verifiedBy: 'P018', verifiedAt: T(-4), completedAt: T(-5), updatedAt: T(-4) }),
      I({ kind: 'contribution', title: 'Designed a new healthy breakfast menu with students', assigneeId: 'P030', createdBy: 'P030', band: '3-6', status: 'verified', evidence: 'photo: menu-board.jpg', evidenceType: 'photo', verifierId: 'P028', verifiedBy: 'P028', verifiedAt: T(-3), completedAt: T(-4), updatedAt: T(-3), thanks: 'Victor Saldanha: Students love it.' }),
      I({ kind: 'contribution', title: 'Built a Maths problem set on probability', assigneeId: 'P015', createdBy: 'P015', initiativeId: 'in_dpp', band: '3-6', status: 'verified', evidence: 'https://drive.google.com/demo-prob', evidenceType: 'link', verifierId: 'P006', verifiedBy: 'P006', verifiedAt: T(-6), completedAt: T(-7), updatedAt: T(-6) }),
      I({ kind: 'contribution', title: 'Trained 8 student volunteers on telescope set-up', assigneeId: 'P010', createdBy: 'P010', initiativeId: 'in_fete', band: '1-3', status: 'verified', evidence: 'Witness: Imran Sheikh', evidenceType: 'witness', verifierId: 'P008', verifiedBy: 'P008', verifiedAt: T(-8), completedAt: T(-9), updatedAt: T(-8) })
    ];
    var duties = [
      { id: 'du1', title: 'Share timetable, working hours and paper-prep status with Trustees', sopRef: 'Administrator, Academics, item 1', ownerType: 'person', ownerId: 'P006', freq: 'weekly', dow: '6', dom: '', time: '12:00', evidenceHint: 'Link to the shared sheet', initiativeId: '', active: 'true' },
      { id: 'du2', title: 'Weekly correction and paper-prep counts (Physics)', sopRef: 'Physics AA', ownerType: 'person', ownerId: 'P016', freq: 'weekly', dow: '6', dom: '', time: '17:00', evidenceHint: 'Sheet link', initiativeId: '', active: 'true' },
      { id: 'du3', title: 'Hostel night attendance check', sopRef: 'Warden', ownerType: 'person', ownerId: 'P020', freq: 'daily', dow: '', dom: '', time: '21:30', evidenceHint: 'Photo of the register', initiativeId: '', active: 'true' },
      { id: 'du4', title: 'Monthly café hygiene checklist', sopRef: 'Café', ownerType: 'team', ownerId: 'tm_cafe', freq: 'monthly', dom: '1', dow: '', time: '', evidenceHint: 'Checklist photo', initiativeId: 'in_paperless', active: 'true' }
    ];
    var overdueDuty = I({ kind: 'duty', title: 'Weekly correction and paper-prep counts (Physics)', assigneeId: 'P016', createdBy: 'system', dutyId: 'du2', due: D(-3), dueTime: '17:00', status: 'open', notes: 'SOP: Physics AA. Evidence: Sheet link' });
    items.push(overdueDuty);
    var decisions = [
      { id: 'dc1', initiativeId: 'in_dpp', decision: 'Scale up', note: 'Extend the problem bank to Maths next term', byId: 'P005', at: T(-20), followups: '' }
    ];
    var events = items.map(function (it, i) { return { id: 'ev_demo' + i, itemId: it.id, actorId: it.createdBy, action: 'created', note: Core.KINDS[it.kind] || '', at: it.createdAt }; });
    return { people: people, teams: teams, memberships: memberships, priorities: priorities, initiatives: initiatives, items: items, events: events, duties: duties, decisions: decisions, settings: [{ key: 'orgName', value: 'Work Tracker (demo)' }, { key: 'termStart', value: D(-60) }], outbox: [], summaries: [], reviews: [{ id: 'rv_demo1', teamId: 'tm_phy', date: D(-7), heldBy: 'P008', notes: 'Agreed to finish Test 2 blueprint first.', commitments: 'it_demo2' }] };
  }
  return { build: build };
})();
if (typeof module !== 'undefined') module.exports = DemoData;
