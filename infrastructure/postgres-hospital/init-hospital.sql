-- Kích hoạt extension pgvector (nếu cần dùng AI/Vector search cho dữ liệu bệnh viện)
CREATE EXTENSION IF NOT EXISTS vector;

-- 1. Patients
CREATE TABLE IF NOT EXISTS patients (
    id VARCHAR(64) PRIMARY KEY, birthdate DATE, deathdate DATE, ssn VARCHAR(32),
    drivers VARCHAR(32), passport VARCHAR(32), prefix VARCHAR(16), first VARCHAR(64),
    last VARCHAR(64), suffix VARCHAR(16), maiden VARCHAR(64), marital VARCHAR(16),
    race VARCHAR(32), ethnicity VARCHAR(32), gender VARCHAR(16), birthplace VARCHAR(128),
    address VARCHAR(128), city VARCHAR(64), state VARCHAR(64), county VARCHAR(64),
    fips VARCHAR(16), zip VARCHAR(16), lat NUMERIC, lon NUMERIC,
    healthcare_expenses NUMERIC, healthcare_coverage NUMERIC
);

-- 2. Organizations
CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(64) PRIMARY KEY, name VARCHAR(255), address VARCHAR(128),
    city VARCHAR(64), state VARCHAR(64), zip VARCHAR(16), lat NUMERIC, lon NUMERIC,
    phone VARCHAR(32), revenue NUMERIC, utilization NUMERIC
);

-- 3. Providers
CREATE TABLE IF NOT EXISTS providers (
    id VARCHAR(64) PRIMARY KEY, organization VARCHAR(64) REFERENCES organizations(id),
    name VARCHAR(255), gender VARCHAR(16), speciality VARCHAR(128),
    address VARCHAR(128), city VARCHAR(64), state VARCHAR(64), zip VARCHAR(16),
    lat NUMERIC, lon NUMERIC, encounts NUMERIC, procedures NUMERIC
);

-- 4. Payers
CREATE TABLE IF NOT EXISTS payers (
    id VARCHAR(64) PRIMARY KEY, name VARCHAR(255), address VARCHAR(128),
    city VARCHAR(64), state_headquartered VARCHAR(64), zip VARCHAR(16),
    phone VARCHAR(32), amount_covered NUMERIC, amount_uncovered NUMERIC,
    revenue NUMERIC, covered_encounters NUMERIC, uncovered_encounters NUMERIC,
    covered_medications NUMERIC, uncovered_medications NUMERIC,
    covered_procedures NUMERIC, uncovered_procedures NUMERIC,
    unique_customers NUMERIC, qols_avg NUMERIC
);

-- 5. Payer Transitions
CREATE TABLE IF NOT EXISTS payer_transitions (
    patient VARCHAR(64) REFERENCES patients(id), start_year INT,
    end_year INT, payer VARCHAR(64) REFERENCES payers(id), ownership VARCHAR(64)
);

-- 6. Encounters
CREATE TABLE IF NOT EXISTS encounters (
    id VARCHAR(64) PRIMARY KEY, start_time TIMESTAMP, stop_time TIMESTAMP,
    patient VARCHAR(64) REFERENCES patients(id), organization VARCHAR(64) REFERENCES organizations(id),
    provider VARCHAR(64) REFERENCES providers(id), payer VARCHAR(64) REFERENCES payers(id),
    encounterclass VARCHAR(64), code VARCHAR(32), description VARCHAR(255),
    base_encounter_cost NUMERIC, total_claim_cost NUMERIC, payer_coverage NUMERIC,
    reasoncode VARCHAR(32), reasondescription VARCHAR(255)
);

-- 7. Allergies
CREATE TABLE IF NOT EXISTS allergies (
    start_date DATE, stop_date DATE, patient VARCHAR(64) REFERENCES patients(id),
    encounter VARCHAR(64) REFERENCES encounters(id), code VARCHAR(32),
    system VARCHAR(64), description VARCHAR(255), type VARCHAR(32),
    category VARCHAR(32), reaction1 VARCHAR(64), description1 VARCHAR(255),
    severity1 VARCHAR(32), reaction2 VARCHAR(64), description2 VARCHAR(255), severity2 VARCHAR(32)
);

-- 8. Careplans
CREATE TABLE IF NOT EXISTS careplans (
    id VARCHAR(64) PRIMARY KEY, start_date DATE, stop_date DATE,
    patient VARCHAR(64) REFERENCES patients(id), encounter VARCHAR(64) REFERENCES encounters(id),
    code VARCHAR(32), description VARCHAR(255), reasoncode VARCHAR(32), reasondescription VARCHAR(255)
);

-- 9. Claims
CREATE TABLE IF NOT EXISTS claims (
    id VARCHAR(64) PRIMARY KEY, patient VARCHAR(64) REFERENCES patients(id),
    provider VARCHAR(64) REFERENCES providers(id), primarypatientinsuranceid VARCHAR(64),
    secondarypatientinsuranceid VARCHAR(64), departmentid VARCHAR(32),
    patientdepartmentid VARCHAR(32), diagnosis1 VARCHAR(32), diagnosis2 VARCHAR(32),
    diagnosis3 VARCHAR(32), diagnosis4 VARCHAR(32), diagnosis5 VARCHAR(32),
    diagnosis6 VARCHAR(32), diagnosis7 VARCHAR(32), diagnosis8 VARCHAR(32),
    referringproviderid VARCHAR(64), appointmentid VARCHAR(64),
    currentillnessdate TIMESTAMP, servicedate TIMESTAMP, supercedingclaimid VARCHAR(64)
);

-- 10. Claims Transactions
CREATE TABLE IF NOT EXISTS claims_transactions (
    id VARCHAR(64) PRIMARY KEY, claimid VARCHAR(64) REFERENCES claims(id),
    chargeid VARCHAR(32), patient VARCHAR(64) REFERENCES patients(id),
    type VARCHAR(32), amount NUMERIC, method VARCHAR(32),
    fromdate TIMESTAMP, todate TIMESTAMP, placeofservice VARCHAR(64),
    procedurecode VARCHAR(32), modifier1 VARCHAR(16), modifier2 VARCHAR(16),
    diagnosisref1 VARCHAR(16), diagnosisref2 VARCHAR(16), units NUMERIC,
    departmentid VARCHAR(32), notes TEXT, unitamount NUMERIC,
    transferoutclaimid VARCHAR(64), transferinclaimid VARCHAR(64),
    opphysicianid VARCHAR(64), renderingphysicianid VARCHAR(64),
    supervisingphysicianid VARCHAR(64)
);

-- 11. Conditions
CREATE TABLE IF NOT EXISTS conditions (
    start_date DATE, stop_date DATE, patient VARCHAR(64) REFERENCES patients(id),
    encounter VARCHAR(64) REFERENCES encounters(id), code VARCHAR(32), description VARCHAR(255)
);

-- 12. Devices
CREATE TABLE IF NOT EXISTS devices (
    start_time TIMESTAMP, stop_time TIMESTAMP, patient VARCHAR(64) REFERENCES patients(id),
    encounter VARCHAR(64) REFERENCES encounters(id), code VARCHAR(32),
    description VARCHAR(255), udi VARCHAR(128)
);

-- 13. Imaging Studies
CREATE TABLE IF NOT EXISTS imaging_studies (
    id VARCHAR(64) PRIMARY KEY, obs_date TIMESTAMP, patient VARCHAR(64) REFERENCES patients(id),
    encounter VARCHAR(64) REFERENCES encounters(id), series_uid VARCHAR(128),
    bodysite_code VARCHAR(32), bodysite_description VARCHAR(255),
    modality_code VARCHAR(32), modality_description VARCHAR(255),
    instance_uid VARCHAR(128), sop_code VARCHAR(32), sop_description VARCHAR(255),
    procedure_code VARCHAR(32)
);

-- 14. Immunizations
CREATE TABLE IF NOT EXISTS immunizations (
    obs_date TIMESTAMP, patient VARCHAR(64) REFERENCES patients(id),
    encounter VARCHAR(64) REFERENCES encounters(id), code VARCHAR(32),
    description VARCHAR(255), base_cost NUMERIC
);

-- 15. Medications
CREATE TABLE IF NOT EXISTS medications (
    start_time TIMESTAMP, stop_time TIMESTAMP, patient VARCHAR(64) REFERENCES patients(id),
    payer VARCHAR(64) REFERENCES payers(id), encounter VARCHAR(64) REFERENCES encounters(id),
    code VARCHAR(32), description VARCHAR(255), base_cost NUMERIC,
    payer_coverage NUMERIC, dispenses INT, totalcost NUMERIC,
    reasoncode VARCHAR(32), reasondescription VARCHAR(255)
);

-- 16. Observations
CREATE TABLE IF NOT EXISTS observations (
    obs_date TIMESTAMP, patient VARCHAR(64) REFERENCES patients(id),
    encounter VARCHAR(64) REFERENCES encounters(id), category VARCHAR(64),
    code VARCHAR(32), description VARCHAR(255), value VARCHAR(255),
    units VARCHAR(32), type VARCHAR(32)
);

-- 17. Procedures
CREATE TABLE IF NOT EXISTS procedures (
    start_time TIMESTAMP, stop_time TIMESTAMP, patient VARCHAR(64) REFERENCES patients(id),
    encounter VARCHAR(64) REFERENCES encounters(id), code VARCHAR(32),
    description VARCHAR(255), base_cost NUMERIC, reasoncode VARCHAR(32), reasondescription VARCHAR(255)
);

-- 18. Supplies
CREATE TABLE IF NOT EXISTS supplies (
    obs_date DATE, patient VARCHAR(64) REFERENCES patients(id),
    encounter VARCHAR(64) REFERENCES encounters(id), code VARCHAR(32),
    description VARCHAR(255), quantity INT
);

-- Cấp quyền kết nối và dùng schema public
GRANT ALL PRIVILEGES ON DATABASE hospital_db TO hospitaladmin;
GRANT ALL ON SCHEMA public TO hospitaladmin;

-- Cấp quyền trên tất cả các bảng HIỆN CÓ
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO hospitaladmin;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO hospitaladmin;

-- TỰ ĐỘNG cấp quyền cho các bảng SẼ TẠO TRONG TƯƠNG LAI
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO hospitaladmin;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO hospitaladmin;