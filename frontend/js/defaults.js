/* defaults.js — default project master data & lookup lists (moved out of the old storage.js) */
const DEFAULT_MASTER = {
  id: 'singleton',
  projectTitle: 'Resident Supervision of Construction of Gates & Boundary Wall of Punjab Government Servants Housing Scheme at Jhang',
  client: 'Punjab Government Servants Housing Foundation (PGSHF)',
  clientAddress: 'Director (M&FPs), PGSHF, 6-C, Street-Q Extension, Scotch Corner, Upper Mall Scheme, Lahore.',
  consultant: 'Engineering Axis (Pvt.) Ltd.',
  facility: 'Gates and Boundary Wall',
  location: 'Jhang, Punjab, Pakistan',
  projectDuration: '12 Months',
  projectEstimate: 'Rs. 210.892 Million',
  mobilizationDate: '2026-05-01',
  residentEngineer: 'Engineer Ahmad Moaz',
  qualityInspector: 'Aqib Javed Bismil',
  projectCoordinator: 'Engineer Muhammad Aazan Kashif',
  governingStandards: 'Engineering Standards and Technical Specifications (1967), together with applicable C&W amendments.',
  baseline: {
    quantities: [
      { activity: 'Foundation Excavation', wall1: '1575 ft', wall2: '747 ft', wall3: '412 ft' },
      { activity: 'PCC 1:4:8', wall1: '1575 ft', wall2: '747 ft', wall3: '212 ft' },
      { activity: 'Brickwork Below NSL', wall1: '1575 ft', wall2: '675 ft', wall3: '—' },
      { activity: 'Brickwork Above NSL to Plinth Bottom', wall1: '1575 ft', wall2: '603 ft', wall3: '—' },
      { activity: 'Plinth Beam Concrete', wall1: '—', wall2: '450 ft', wall3: '—' },
      { activity: 'Superstructure Brickwork Above Plinth', wall1: '—', wall2: "200 ft till 4'-0\"", wall3: '—' }
    ],
    specs: [
      "Foundation excavation depth/width: 2'-6\"",
      'PCC 1:4:8 thickness: 4"',
      "PCC width: 2'-6\"",
      "Brickwork below NSL depth: 2'-2\"",
      "Wall-1 above NSL: 4'-0\"",
      "Wall-2 above NSL: 4'-6\"",
      "Wall-3 above NSL: 4'-6\" to 5'-0\"",
      'Plinth beam: 9" x 9"',
      'Plinth beam reinforcement: 4-#4 bars',
      'Plinth beam ties: #3 @ 8" o.c.',
      "Total superstructure height: 5'-6\"",
      "One panel: 36'-0\""
    ]
  },
  materials: {
    cement: { brand: 'Maple Leaf', notes: 'Airtight bags. No lumps. Stored on raised wooden pallets. Protected with waterproof sheets.' },
    bricks: { brand: 'AU & KB', notes: 'First-class clay bricks. Well-burnt. Sharp edges. Uniform appearance.' },
    fineAggregate: { source: 'Sargodha', notes: 'Clean. Sharp. Free from organic matter.' },
    coarseAggregate: { source: 'Sargodha', notes: 'Angular. Free from soft/flaky pieces. Free from excessive dust coatings.' }
  }
};

const ACTIVITY_CATEGORIES = [
  'Foundation Excavation', 'PCC', 'Brickwork Below NSL', 'Brickwork Above NSL',
  'Plinth Beam', 'Superstructure Brickwork', 'Columns', 'Plaster', 'Pointing', 'Coping', 'Other'
];

const STRUCTURAL_ELEMENTS = ['Wall-1', 'Wall-2', 'Wall-3', 'Gate', 'Other'];
