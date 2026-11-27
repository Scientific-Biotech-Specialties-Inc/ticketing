/**
 * Mock & Persistence Layer for Contract Management System (CMS) Customer Integration
 *
 * Provides mock customer profiles, contracts, SLA commitments, and covered equipment
 * fetched from the external Contract Management System (CRMS / CMS) into the Ticketing System.
 */

const STORAGE_KEY = 'ts_cms_synced_customers_store';
const SETTINGS_KEY = 'ts_cms_integration_settings';

export const INITIAL_CMS_CUSTOMERS = [
  {
    id: 'cms-cust-001',
    cmsClientId: 'CMS-CLI-2024-0101',
    companyName: "St. Luke's Medical Center - Global City",
    tradeName: 'SLMC BGC',
    category: 'Tertiary Hospital',
    taxIdentificationNumber: '000-842-194-000',
    assignedBranch: 'NCR - Main',
    primaryContact: {
      name: 'Dr. Rafael V. Santos',
      title: 'Chief Medical Technologist / Laboratory Director',
      email: 'r.santos@stluke.com.ph',
      phone: '+63 2 8789 7700',
      mobile: '+63 917 842 1928',
    },
    secondaryContact: {
      name: 'Maria Teresa Lim',
      title: 'Biomedical Procurement Head',
      email: 'mt.lim@stluke.com.ph',
      phone: '+63 2 8789 7701',
      mobile: '+63 918 555 9012',
    },
    address: {
      street: '32nd Street cor. 5th Avenue, Bonifacio Global City',
      city: 'Taguig City',
      province: 'Metro Manila',
      postalCode: '1634',
    },
    contract: {
      contractNumber: 'CMS-CON-2024-0089',
      contractTitle: 'Comprehensive Hematology & Immunochemistry Service Contract',
      contractType: 'Annual Maintenance Contract (AMC)',
      tier: 'Enterprise Platinum',
      slaResponseHours: 2,
      slaResolutionHours: 4,
      slaDescription: '2-hour priority on-site response for critical analyzer breakdown; 4-hour MTTR with standby hot-swap units.',
      startDate: '2024-01-15',
      endDate: '2026-12-31',
      status: 'Active',
      contractValue: 'PHP 5,450,000.00',
      billingTerm: 'Quarterly Post-Paid',
    },
    coveredEquipment: [
      {
        assetTag: 'EQ-SBSI-8821',
        model: 'Sysmex XN-1000 Automated Hematology Analyzer',
        serialNumber: 'SN-XN1K-44921',
        department: 'Clinical Hematology',
        installationDate: '2023-03-10',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-10-14',
        nextPmsDate: '2025-01-14',
      },
      {
        assetTag: 'EQ-SBSI-8822',
        model: 'Cobas 6000 Clinical Chemistry System',
        serialNumber: 'SN-CB6K-99104',
        department: 'Main Diagnostic Lab',
        installationDate: '2023-05-18',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-09-22',
        nextPmsDate: '2024-12-22',
      },
      {
        assetTag: 'EQ-SBSI-8823',
        model: 'Mindray BS-800M Chemistry Analyzer',
        serialNumber: 'SN-MBS8-12003',
        department: 'Emergency STAT Lab',
        installationDate: '2023-08-01',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-11-05',
        nextPmsDate: '2025-02-05',
      },
    ],
    ticketingIntegration: {
      storeStatus: 'Stored',
      linkedTicketCustomerId: 'CUST-8021',
      linkedCustomerEmail: 'r.santos@stluke.com.ph',
      syncTimestamp: '2026-11-15T08:30:00Z',
      syncVersion: 4,
      autoTriageEnabled: true,
      openTicketsCount: 1,
    },
  },
  {
    id: 'cms-cust-002',
    cmsClientId: 'CMS-CLI-2024-0102',
    companyName: 'The Medical City - Ortigas',
    tradeName: 'TMC Ortigas',
    category: 'Tertiary Hospital',
    taxIdentificationNumber: '000-312-887-000',
    assignedBranch: 'NCR - Main',
    primaryContact: {
      name: 'Engr. Bernardo Alcantara',
      title: 'Director of Clinical Engineering',
      email: 'balcantara@themedicalcity.com',
      phone: '+63 2 8988 1000',
      mobile: '+63 920 441 8891',
    },
    secondaryContact: {
      name: 'Dr. Clarissa De Vera',
      title: 'Pathology Department Head',
      email: 'cdevera@themedicalcity.com',
      phone: '+63 2 8988 1002',
      mobile: '+63 917 223 8810',
    },
    address: {
      street: 'Ortigas Avenue, Pasig City',
      city: 'Pasig City',
      province: 'Metro Manila',
      postalCode: '1605',
    },
    contract: {
      contractNumber: 'CMS-CON-2024-0112',
      contractTitle: 'Automated Chemistry & Reagent Supply Agreement',
      contractType: 'Comprehensive SLA',
      tier: 'Enterprise Platinum',
      slaResponseHours: 2,
      slaResolutionHours: 6,
      slaDescription: '2-hour emergency remote/phone triage; 4-hour on-site deployment with dedicated biomedical specialist.',
      startDate: '2024-02-01',
      endDate: '2027-01-31',
      status: 'Active',
      contractValue: 'PHP 6,800,000.00',
      billingTerm: 'Monthly Progress Billing',
    },
    coveredEquipment: [
      {
        assetTag: 'EQ-SBSI-9011',
        model: 'Abbott Architect ci4100 Integrated System',
        serialNumber: 'SN-ABBT-77210',
        department: 'Biochemistry Division',
        installationDate: '2023-01-20',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-10-30',
        nextPmsDate: '2025-01-30',
      },
      {
        assetTag: 'EQ-SBSI-9012',
        model: 'Bio-Rad D-10 Hemoglobin Testing System',
        serialNumber: 'SN-BRD10-33019',
        department: 'Diabetes & Endocrinology Center',
        installationDate: '2023-06-15',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-11-02',
        nextPmsDate: '2025-02-02',
      },
    ],
    ticketingIntegration: {
      storeStatus: 'Stored',
      linkedTicketCustomerId: 'CUST-8025',
      linkedCustomerEmail: 'balcantara@themedicalcity.com',
      syncTimestamp: '2026-11-16T09:15:00Z',
      syncVersion: 3,
      autoTriageEnabled: true,
      openTicketsCount: 0,
    },
  },
  {
    id: 'cms-cust-003',
    cmsClientId: 'CMS-CLI-2024-0103',
    companyName: 'Philippine General Hospital',
    tradeName: 'UP-PGH Manila',
    category: 'Government National University Hospital',
    taxIdentificationNumber: '000-112-990-001',
    assignedBranch: 'NCR - Main',
    primaryContact: {
      name: 'Dr. Remedios F. Tan',
      title: 'Head of Clinical Pathology Division',
      email: 'rtan@pgh.gov.ph',
      phone: '+63 2 8554 8400',
      mobile: '+63 922 819 0044',
    },
    secondaryContact: {
      name: 'Nelson Bautista',
      title: 'Hospital Equipment Section Supervisor',
      email: 'nbautista@pgh.gov.ph',
      phone: '+63 2 8554 8410',
      mobile: '+63 915 771 9023',
    },
    address: {
      street: 'Taft Avenue, Ermita',
      city: 'Manila',
      province: 'Metro Manila',
      postalCode: '1000',
    },
    contract: {
      contractNumber: 'CMS-CON-2023-0491',
      contractTitle: 'Annual Diagnostic Hardware Maintenance & Calibration',
      contractType: 'Preventive Maintenance SLA',
      tier: 'Premium Gold',
      slaResponseHours: 4,
      slaResolutionHours: 8,
      slaDescription: '4-hour business hour response; 8-hour component replacement commitment.',
      startDate: '2023-12-01',
      endDate: '2026-11-30',
      status: 'Expiring Soon',
      contractValue: 'PHP 3,920,000.00',
      billingTerm: 'Bi-Annual Advance',
    },
    coveredEquipment: [
      {
        assetTag: 'EQ-SBSI-7740',
        model: 'Sysmex CS-1600 Automated Coagulation Analyzer',
        serialNumber: 'SN-CS16-90412',
        department: 'Blood Bank & Coagulation',
        installationDate: '2022-11-10',
        warrantyStatus: 'Extended Support',
        lastPmsDate: '2024-08-19',
        nextPmsDate: '2024-11-19',
      },
    ],
    ticketingIntegration: {
      storeStatus: 'Stored',
      linkedTicketCustomerId: 'CUST-8032',
      linkedCustomerEmail: 'rtan@pgh.gov.ph',
      syncTimestamp: '2026-11-14T11:45:00Z',
      syncVersion: 2,
      autoTriageEnabled: true,
      openTicketsCount: 2,
    },
  },
  {
    id: 'cms-cust-004',
    cmsClientId: 'CMS-CLI-2024-0104',
    companyName: 'Chong Hua Hospital - Cebu',
    tradeName: 'Chong Hua Cebu',
    category: 'Tertiary Hospital',
    taxIdentificationNumber: '001-445-882-000',
    assignedBranch: 'Cebu Regional Branch',
    primaryContact: {
      name: 'Kenneth G. Sy',
      title: 'Chief Operating Officer / Facilities Admin',
      email: 'k.sy@chonghua.com.ph',
      phone: '+63 32 255 8000',
      mobile: '+63 917 662 1089',
    },
    secondaryContact: {
      name: 'Lorena C. Yap',
      title: 'Diagnostic Logistics Coordinator',
      email: 'l.yap@chonghua.com.ph',
      phone: '+63 32 255 8005',
      mobile: '+63 920 882 1990',
    },
    address: {
      street: 'Don Mariano Cui Street, Fuente Osmeña',
      city: 'Cebu City',
      province: 'Cebu',
      postalCode: '6000',
    },
    contract: {
      contractNumber: 'CMS-CON-2024-0220',
      contractTitle: 'Regional Diagnostic Network Maintenance Agreement',
      contractType: 'Annual Maintenance Contract (AMC)',
      tier: 'Enterprise Platinum',
      slaResponseHours: 2,
      slaResolutionHours: 4,
      slaDescription: '2-hour response backed by dedicated Cebu Regional field service engineers.',
      startDate: '2024-03-01',
      endDate: '2027-02-28',
      status: 'Active',
      contractValue: 'PHP 4,750,000.00',
      billingTerm: 'Quarterly',
    },
    coveredEquipment: [
      {
        assetTag: 'EQ-SBSI-6101',
        model: 'Cobas e411 Immunoassay Analyzer',
        serialNumber: 'SN-E411-80129',
        department: 'Endocrinology & Immunology',
        installationDate: '2023-04-12',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-10-18',
        nextPmsDate: '2025-01-18',
      },
      {
        assetTag: 'EQ-SBSI-6102',
        model: 'Mindray BC-6800 Plus Auto Hematology',
        serialNumber: 'SN-BC68-55219',
        department: 'Central Clinical Laboratory',
        installationDate: '2023-07-20',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-10-25',
        nextPmsDate: '2025-01-25',
      },
    ],
    ticketingIntegration: {
      storeStatus: 'Stored',
      linkedTicketCustomerId: 'CUST-8041',
      linkedCustomerEmail: 'k.sy@chonghua.com.ph',
      syncTimestamp: '2026-11-16T12:00:00Z',
      syncVersion: 5,
      autoTriageEnabled: true,
      openTicketsCount: 0,
    },
  },
  {
    id: 'cms-cust-005',
    cmsClientId: 'CMS-CLI-2024-0105',
    companyName: 'Davao Doctors Hospital',
    tradeName: 'DDH Mindanao',
    category: 'Tertiary Hospital',
    taxIdentificationNumber: '000-881-231-000',
    assignedBranch: 'Davao Branch',
    primaryContact: {
      name: 'Dr. Arthur M. Dela Cruz',
      title: 'Laboratory Services Manager',
      email: 'adelacruz@davaodoctors.com.ph',
      phone: '+63 82 222 8000',
      mobile: '+63 918 901 3344',
    },
    secondaryContact: {
      name: 'Grace Pamela Navarro',
      title: 'Biomedical Support Supervisor',
      email: 'gnavarro@davaodoctors.com.ph',
      phone: '+63 82 222 8010',
      mobile: '+63 922 411 7780',
    },
    address: {
      street: '118 E. Quirino Avenue',
      city: 'Davao City',
      province: 'Davao del Sur',
      postalCode: '8000',
    },
    contract: {
      contractNumber: 'CMS-CON-2024-0305',
      contractTitle: 'Southern Mindanao Diagnostic SLA & Reagents',
      contractType: 'Comprehensive SLA',
      tier: 'Premium Gold',
      slaResponseHours: 4,
      slaResolutionHours: 8,
      slaDescription: '4-hour on-site response during operational hours; 24-hour backup unit guarantee.',
      startDate: '2024-04-15',
      endDate: '2026-04-14',
      status: 'Active',
      contractValue: 'PHP 3,600,000.00',
      billingTerm: 'Quarterly',
    },
    coveredEquipment: [
      {
        assetTag: 'EQ-SBSI-5501',
        model: 'Qiagen QIAcube Connect Robotic DNA/RNA Extractor',
        serialNumber: 'SN-QIAC-33108',
        department: 'Molecular Biology & Pathology',
        installationDate: '2023-09-05',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-09-12',
        nextPmsDate: '2024-12-12',
      },
    ],
    ticketingIntegration: {
      storeStatus: 'Stored',
      linkedTicketCustomerId: 'CUST-8055',
      linkedCustomerEmail: 'adelacruz@davaodoctors.com.ph',
      syncTimestamp: '2026-11-15T15:20:00Z',
      syncVersion: 2,
      autoTriageEnabled: true,
      openTicketsCount: 0,
    },
  },
  {
    id: 'cms-cust-006',
    cmsClientId: 'CMS-CLI-2024-0106',
    companyName: 'National Kidney and Transplant Institute',
    tradeName: 'NKTI Diliman',
    category: 'Specialty Government Medical Center',
    taxIdentificationNumber: '000-541-921-001',
    assignedBranch: 'NCR - Main',
    primaryContact: {
      name: 'Dr. Gabriel H. Mendoza',
      title: 'Transplant Diagnostic Center Supervisor',
      email: 'gmendoza@nkti.gov.ph',
      phone: '+63 2 8981 0300',
      mobile: '+63 917 554 9911',
    },
    secondaryContact: {
      name: 'Joanna Marie Santos',
      title: 'Head of Clinical Chemistry',
      email: 'jsantos@nkti.gov.ph',
      phone: '+63 2 8981 0305',
      mobile: '+63 919 443 2200',
    },
    address: {
      street: 'East Avenue, Diliman',
      city: 'Quezon City',
      province: 'Metro Manila',
      postalCode: '1100',
    },
    contract: {
      contractNumber: 'CMS-CON-2024-0155',
      contractTitle: 'Critical Renal Diagnostics 24/7 SLA',
      contractType: 'Comprehensive SLA',
      tier: 'Enterprise Platinum',
      slaResponseHours: 2,
      slaResolutionHours: 4,
      slaDescription: '2-hour maximum response for renal transplantation laboratory diagnostic equipment.',
      startDate: '2024-01-01',
      endDate: '2026-12-31',
      status: 'Active',
      contractValue: 'PHP 7,200,000.00',
      billingTerm: 'Monthly Progress Billing',
    },
    coveredEquipment: [
      {
        assetTag: 'EQ-SBSI-4401',
        model: 'Sysmex XN-2000 Automated Hematology System',
        serialNumber: 'SN-XN2K-88124',
        department: 'Hematology & Bone Marrow Lab',
        installationDate: '2023-02-15',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-11-01',
        nextPmsDate: '2025-02-01',
      },
      {
        assetTag: 'EQ-SBSI-4402',
        model: 'Bio-Rad Variant II Turbo Hemoglobin System',
        serialNumber: 'SN-VII-66023',
        department: 'Special Chemistry & Hemoglobinopathies',
        installationDate: '2023-04-10',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-10-15',
        nextPmsDate: '2025-01-15',
      },
    ],
    ticketingIntegration: {
      storeStatus: 'Stored',
      linkedTicketCustomerId: 'CUST-8060',
      linkedCustomerEmail: 'gmendoza@nkti.gov.ph',
      syncTimestamp: '2026-11-16T16:00:00Z',
      syncVersion: 4,
      autoTriageEnabled: true,
      openTicketsCount: 1,
    },
  },
  {
    id: 'cms-cust-007',
    cmsClientId: 'CMS-CLI-2024-0107',
    companyName: 'BioPath Diagnostic Laboratories Inc.',
    tradeName: 'BioPath Makati',
    category: 'Private Reference Laboratory',
    taxIdentificationNumber: '002-991-382-000',
    assignedBranch: 'NCR - Main',
    primaryContact: {
      name: 'Jennifer C. Gomez',
      title: 'Chief Operations Officer',
      email: 'jgomez@biopathlabs.ph',
      phone: '+63 2 8812 4000',
      mobile: '+63 920 771 9934',
    },
    secondaryContact: {
      name: 'Mark Lester Ocampo',
      title: 'Lab Quality Officer',
      email: 'mocampo@biopathlabs.ph',
      phone: '+63 2 8812 4005',
      mobile: '+63 917 884 1022',
    },
    address: {
      street: 'Chino Roces Avenue Extension',
      city: 'Makati City',
      province: 'Metro Manila',
      postalCode: '1231',
    },
    contract: {
      contractNumber: 'CMS-CON-2024-0410',
      contractTitle: 'Standard Diagnostic Equipment Service & Maintenance',
      contractType: 'Preventive Maintenance SLA',
      tier: 'Standard Silver',
      slaResponseHours: 8,
      slaResolutionHours: 24,
      slaDescription: 'Next-business-day response; bi-monthly scheduled preventive maintenance.',
      startDate: '2024-05-01',
      endDate: '2025-04-30',
      status: 'Active',
      contractValue: 'PHP 1,850,000.00',
      billingTerm: 'Annual Advance',
    },
    coveredEquipment: [
      {
        assetTag: 'EQ-SBSI-3201',
        model: 'Mindray BS-480 Chemistry Analyzer',
        serialNumber: 'SN-BS48-90112',
        department: 'Outpatient Diagnostics',
        installationDate: '2023-08-20',
        warrantyStatus: 'Standard SLA',
        lastPmsDate: '2024-10-05',
        nextPmsDate: '2024-12-05',
      },
    ],
    ticketingIntegration: {
      storeStatus: 'Pending Store',
      linkedTicketCustomerId: null,
      linkedCustomerEmail: 'jgomez@biopathlabs.ph',
      syncTimestamp: '2026-11-16T17:40:00Z',
      syncVersion: 1,
      autoTriageEnabled: false,
      openTicketsCount: 0,
    },
  },
  {
    id: 'cms-cust-008',
    cmsClientId: 'CMS-CLI-2024-0108',
    companyName: 'Asian Hospital and Medical Center',
    tradeName: 'AHMC Alabang',
    category: 'Tertiary Hospital',
    taxIdentificationNumber: '000-721-445-000',
    assignedBranch: 'NCR - Main',
    primaryContact: {
      name: 'Dr. Emmanuel P. Sison',
      title: 'Pathology & Laboratory Director',
      email: 'esison@asianhospital.com',
      phone: '+63 2 8771 9000',
      mobile: '+63 917 339 0182',
    },
    secondaryContact: {
      name: 'Rowena V. Dizon',
      title: 'Hospital Supply Manager',
      email: 'rdizon@asianhospital.com',
      phone: '+63 2 8771 9008',
      mobile: '+63 918 221 4409',
    },
    address: {
      street: '2205 Civic Drive, Filinvest Corporate City, Alabang',
      city: 'Muntinlupa City',
      province: 'Metro Manila',
      postalCode: '1781',
    },
    contract: {
      contractNumber: 'CMS-CON-2023-0105',
      contractTitle: 'Comprehensive Clinical Analyzer Maintenance & Supply',
      contractType: 'Annual Maintenance Contract (AMC)',
      tier: 'Enterprise Platinum',
      slaResponseHours: 2,
      slaResolutionHours: 4,
      slaDescription: '2-hour on-site response for urgent diagnostics; quarterly preventive checkups.',
      startDate: '2023-10-01',
      endDate: '2024-09-30',
      status: 'Expired',
      contractValue: 'PHP 5,100,000.00',
      billingTerm: 'Quarterly',
    },
    coveredEquipment: [
      {
        assetTag: 'EQ-SBSI-2101',
        model: 'Cobas 8000 Modular Analyzer Series',
        serialNumber: 'SN-CB8K-77119',
        department: 'Core Laboratory',
        installationDate: '2022-09-15',
        warrantyStatus: 'Expired (Renewal Pending)',
        lastPmsDate: '2024-09-10',
        nextPmsDate: '2024-12-10',
      },
    ],
    ticketingIntegration: {
      storeStatus: 'Stored',
      linkedTicketCustomerId: 'CUST-8072',
      linkedCustomerEmail: 'esison@asianhospital.com',
      syncTimestamp: '2026-11-14T08:00:00Z',
      syncVersion: 2,
      autoTriageEnabled: false,
      openTicketsCount: 0,
    },
  },
];

/**
 * Incoming records pool ready to be fetched from CMS to simulate new integration discoveries
 */
export const INCOMING_CMS_POOL = [
  {
    id: 'cms-cust-009',
    cmsClientId: 'CMS-CLI-2024-0109',
    companyName: 'Baguio General Hospital and Medical Center',
    tradeName: 'BGHMC Baguio',
    category: 'Government Tertiary Regional Training Hospital',
    taxIdentificationNumber: '000-441-112-001',
    assignedBranch: 'North Luzon Branch',
    primaryContact: {
      name: 'Dr. Christopher A. Flores',
      title: 'Laboratory Section Head',
      email: 'cflores@bghmc.doh.gov.ph',
      phone: '+63 74 442 2012',
      mobile: '+63 917 559 1234',
    },
    secondaryContact: {
      name: 'Corazon M. Ramos',
      title: 'Materials Management Head',
      email: 'cramos@bghmc.doh.gov.ph',
      phone: '+63 74 442 2015',
      mobile: '+63 920 882 4411',
    },
    address: {
      street: 'Gov. Pack Road',
      city: 'Baguio City',
      province: 'Benguet',
      postalCode: '2600',
    },
    contract: {
      contractNumber: 'CMS-CON-2024-0550',
      contractTitle: 'Northern Luzon Healthcare Equipment SLA',
      contractType: 'Comprehensive SLA',
      tier: 'Premium Gold',
      slaResponseHours: 4,
      slaResolutionHours: 8,
      slaDescription: '4-hour on-site response through Baguio service satellite team.',
      startDate: '2024-06-01',
      endDate: '2027-05-31',
      status: 'Active',
      contractValue: 'PHP 4,100,000.00',
      billingTerm: 'Quarterly',
    },
    coveredEquipment: [
      {
        assetTag: 'EQ-SBSI-1901',
        model: 'Sysmex XN-550 Automated Hematology Analyzer',
        serialNumber: 'SN-XN55-22019',
        department: 'Inpatient Clinical Lab',
        installationDate: '2024-05-20',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-10-10',
        nextPmsDate: '2025-01-10',
      },
    ],
    ticketingIntegration: {
      storeStatus: 'Pending Store',
      linkedTicketCustomerId: null,
      linkedCustomerEmail: 'cflores@bghmc.doh.gov.ph',
      syncTimestamp: new Date().toISOString(),
      syncVersion: 1,
      autoTriageEnabled: false,
      openTicketsCount: 0,
    },
  },
  {
    id: 'cms-cust-010',
    cmsClientId: 'CMS-CLI-2024-0110',
    companyName: 'Iloilo Doctors Hospital Inc.',
    tradeName: 'IDH Western Visayas',
    category: 'Private Tertiary Hospital',
    taxIdentificationNumber: '001-884-219-000',
    assignedBranch: 'Western Visayas Branch',
    primaryContact: {
      name: 'Dr. Vincent Paul Locsin',
      title: 'Medical Director & Chief of Clinics',
      email: 'vlocsin@iloidoctors.com.ph',
      phone: '+63 33 337 7702',
      mobile: '+63 919 661 8840',
    },
    secondaryContact: {
      name: 'Elena S. Javellana',
      title: 'Purchasing & Asset Control Supervisor',
      email: 'ejavellana@iloidoctors.com.ph',
      phone: '+63 33 337 7705',
      mobile: '+63 922 770 1923',
    },
    address: {
      street: 'West Avenue, Molo',
      city: 'Iloilo City',
      province: 'Iloilo',
      postalCode: '5000',
    },
    contract: {
      contractNumber: 'CMS-CON-2024-0588',
      contractTitle: 'Western Visayas Automated Diagnostics Service SLA',
      contractType: 'Annual Maintenance Contract (AMC)',
      tier: 'Enterprise Platinum',
      slaResponseHours: 2,
      slaResolutionHours: 4,
      slaDescription: '2-hour urgent breakdown response; preventive maintenance every 60 days.',
      startDate: '2024-07-01',
      endDate: '2026-06-30',
      status: 'Active',
      contractValue: 'PHP 3,800,000.00',
      billingTerm: 'Bi-Annual Post-Paid',
    },
    coveredEquipment: [
      {
        assetTag: 'EQ-SBSI-1105',
        model: 'Mindray CAL 8000 Cellular Analysis Line',
        serialNumber: 'SN-CAL8-44102',
        department: 'Automated Hematology Lab',
        installationDate: '2024-06-15',
        warrantyStatus: 'Under Warranty',
        lastPmsDate: '2024-09-20',
        nextPmsDate: '2024-12-20',
      },
    ],
    ticketingIntegration: {
      storeStatus: 'Pending Store',
      linkedTicketCustomerId: null,
      linkedCustomerEmail: 'vlocsin@iloidoctors.com.ph',
      syncTimestamp: new Date().toISOString(),
      syncVersion: 1,
      autoTriageEnabled: false,
      openTicketsCount: 0,
    },
  },
];

export const DEFAULT_INTEGRATION_SETTINGS = {
  cmsApiEndpoint: 'https://cms.sbsi.com.ph/api/v1/customers/sync',
  cmsApiKey: 'cms_sec_live_9981a7b40f28e1d6c8e541',
  syncInterval: 'Daily at 02:00 AM',
  autoStoreNewRecords: false,
  autoTriageContracts: true,
  enableSlaEnforcement: true,
  notifyOnContractExpiry: true,
  webhookEndpoint: 'https://tickets.sbsi.com.ph/api/integrations/cms/webhook',
  lastSyncResult: 'Success (8 Records Synced)',
  lastSyncTimestamp: '2026-11-16T17:40:00Z',
};

/**
 * Loads stored CMS customers from localStorage or returns initial baseline
 */
export function getStoredCmsCustomers() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_CMS_CUSTOMERS));
      return INITIAL_CMS_CUSTOMERS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_CMS_CUSTOMERS;
  } catch (err) {
    console.error('[CMS Integration] Failed to parse stored customers, fallback to initial:', err);
    return INITIAL_CMS_CUSTOMERS;
  }
}

/**
 * Persists updated CMS customers list to localStorage
 */
export function saveStoredCmsCustomers(records) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
  } catch (err) {
    console.error('[CMS Integration] Failed to persist customers:', err);
  }
}

/**
 * Simulates fetching updated / new customer data from CMS API
 */
export async function fetchLatestFromCmsApi() {
  // Simulate network latency (400-800ms)
  await new Promise((resolve) => setTimeout(resolve, 600));

  const current = getStoredCmsCustomers();
  const existingIds = new Set(current.map((c) => c.cmsClientId));

  // Find incoming records not yet in current state
  const newRecords = INCOMING_CMS_POOL.filter((item) => !existingIds.has(item.cmsClientId));

  if (newRecords.length > 0) {
    const updated = [...newRecords, ...current];
    saveStoredCmsCustomers(updated);
    return {
      success: true,
      newCount: newRecords.length,
      records: updated,
      message: `Successfully fetched ${newRecords.length} new customer record(s) from CMS.`,
    };
  }

  // If all already present, touch the timestamps
  const touched = current.map((item, idx) => {
    if (idx < 2) {
      return {
        ...item,
        ticketingIntegration: {
          ...item.ticketingIntegration,
          syncTimestamp: new Date().toISOString(),
          syncVersion: item.ticketingIntegration.syncVersion + 1,
        },
      };
    }
    return item;
  });

  saveStoredCmsCustomers(touched);
  return {
    success: true,
    newCount: 0,
    records: touched,
    message: 'Sync completed. All CMS customer records are up to date.',
  };
}

/**
 * Commits a single customer record into the Ticketing System customer store
 */
export function storeRecordInTicketing(recordId) {
  const current = getStoredCmsCustomers();
  const index = current.findIndex((c) => c.id === recordId);
  if (index === -1) return { success: false, message: 'Record not found.' };

  const target = current[index];
  const assignedTicketId = target.ticketingIntegration.linkedTicketCustomerId || `CUST-${Math.floor(1000 + Math.random() * 9000)}`;

  const updatedRecord = {
    ...target,
    ticketingIntegration: {
      ...target.ticketingIntegration,
      storeStatus: 'Stored',
      linkedTicketCustomerId: assignedTicketId,
      syncTimestamp: new Date().toISOString(),
      autoTriageEnabled: true,
    },
  };

  current[index] = updatedRecord;
  saveStoredCmsCustomers(current);
  return { success: true, record: updatedRecord, message: `Customer "${target.companyName}" stored into Ticketing System.` };
}

/**
 * Batch stores all pending/staged records into the Ticketing System
 */
export function storeAllPendingRecords() {
  const current = getStoredCmsCustomers();
  let storedCount = 0;

  const updated = current.map((item) => {
    if (item.ticketingIntegration.storeStatus !== 'Stored') {
      storedCount++;
      return {
        ...item,
        ticketingIntegration: {
          ...item.ticketingIntegration,
          storeStatus: 'Stored',
          linkedTicketCustomerId: item.ticketingIntegration.linkedTicketCustomerId || `CUST-${Math.floor(1000 + Math.random() * 9000)}`,
          syncTimestamp: new Date().toISOString(),
          autoTriageEnabled: true,
        },
      };
    }
    return item;
  });

  saveStoredCmsCustomers(updated);
  return { success: true, count: storedCount, records: updated };
}

/**
 * Resets local store back to pristine baseline
 */
export function resetCmsCustomerStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_CMS_CUSTOMERS));
  return INITIAL_CMS_CUSTOMERS;
}

/**
 * Integration Settings
 */
export function getStoredIntegrationSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_INTEGRATION_SETTINGS;
    return { ...DEFAULT_INTEGRATION_SETTINGS, ...JSON.parse(raw) };
  } catch (e) {
    return DEFAULT_INTEGRATION_SETTINGS;
  }
}

export function saveStoredIntegrationSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    return settings;
  } catch (e) {
    console.error('Failed to save CMS settings:', e);
    return settings;
  }
}

/**
 * Creates a new customer & contract record from the SuperAdmin Create User modal
 */
export function createCmsCustomerRecord({
  equipmentName,
  brandAndModel,
  serialNumber,
  customerName,
  customerEmail,
  sbsiBranch,
}) {
  const current = getStoredCmsCustomers();
  const now = new Date();
  const year = now.getFullYear();
  const randCode = Math.floor(1000 + Math.random() * 9000);
  const startDate = now.toISOString().split('T')[0];
  const endDate = new Date(year + 1, now.getMonth(), now.getDate()).toISOString().split('T')[0];

  const modelLabel = equipmentName && brandAndModel
    ? `${equipmentName.trim()} (${brandAndModel.trim()})`
    : (equipmentName || brandAndModel || '').trim();

  const newRecord = {
    id: `cms-cust-${Date.now()}`,
    cmsClientId: `CMS-CLI-${year}-${randCode}`,
    companyName: customerName.trim(),
    tradeName: customerName.trim(),
    category: 'Healthcare / Diagnostic',
    taxIdentificationNumber: 'N/A',
    assignedBranch: sbsiBranch.trim(),
    primaryContact: {
      name: customerName.trim(),
      title: 'Primary Contact',
      email: customerEmail.trim(),
      phone: 'N/A',
      mobile: 'N/A',
    },
    secondaryContact: null,
    address: {
      street: 'N/A',
      city: sbsiBranch.trim(),
      province: 'Philippines',
      postalCode: 'N/A',
    },
    contract: {
      contractNumber: `CMS-CON-${year}-${randCode}`,
      contractTitle: 'Standard Equipment & Software Maintenance Contract',
      contractType: 'Annual Maintenance Contract (AMC)',
      tier: 'Standard Silver',
      slaResponseHours: 8,
      slaResolutionHours: 24,
      slaDescription: 'Standard 8-hour response and 24-hour target resolution.',
      startDate,
      endDate,
      status: 'Active',
      contractValue: 'N/A',
      billingTerm: 'Annual',
    },
    coveredEquipment: [
      {
        assetTag: `EQ-SBSI-${randCode}`,
        equipmentName: equipmentName.trim(),
        brandAndModel: brandAndModel.trim(),
        model: modelLabel,
        serialNumber: serialNumber.trim(),
        department: 'General',
        installationDate: startDate,
        warrantyStatus: 'Under Warranty',
        lastPmsDate: startDate,
        nextPmsDate: endDate,
      },
    ],
    ticketingIntegration: {
      storeStatus: 'Stored',
      linkedTicketCustomerId: `CUST-${randCode}`,
      syncTimestamp: now.toISOString(),
      syncVersion: 1,
      autoTriageEnabled: true,
    },
  };

  const updated = [newRecord, ...current];
  saveStoredCmsCustomers(updated);
  return { success: true, record: newRecord, records: updated };
}
