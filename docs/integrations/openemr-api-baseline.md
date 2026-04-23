# OpenEMR Integration Baseline (RaDE v2)

This document captures observed behavior and constraints of OpenEMR as they relate to the RaDE v2 integration layer.

This is NOT part of OpenEMR itself.
It represents the integration contract from the RaDE perspective.

## OAuth2 Client

| Field | Value |
|-------|-------|
| Client Name | `rade-v2-local` |
| Client ID | `EuYbMOTuC5T0yBf8QhyGgeXtMfvy5Q79YjpjNBM3LMo` |
| Client Secret | `-Jaf5ASOmhag-EnTgXBFSq4yWlT2KMQAwIAA3_EQfkVPIeZ9GicNzEGXm4TAGHmnSSicHH1Q9RkOPGSg4vKd0g` |
| Grant Type | `password` |
| User Role | `users` |
| Scopes | `openid api:oemr api:fhir user/Patient.read user/Patient.write user/Encounter.read user/Observation.read user/encounter.crus user/vital.crus user/patient.crus offline_access` |

## Endpoints

| Purpose | URL |
|---------|-----|
| Token | `https://localhost:9300/oauth2/default/token` |
| FHIR Base | `https://localhost:9300/apis/default/fhir` |
| Standard API Base | `https://localhost:9300/apis/default/api` |
| SMART Config | `https://localhost:9300/apis/default/fhir/.well-known/smart-configuration` |

## 1. Get Token

```bash
TOKEN=$(curl -sk -X POST https://localhost:9300/oauth2/default/token \
  -d 'grant_type=password' \
  -d 'client_id=EuYbMOTuC5T0yBf8QhyGgeXtMfvy5Q79YjpjNBM3LMo' \
  -d 'client_secret=-Jaf5ASOmhag-EnTgXBFSq4yWlT2KMQAwIAA3_EQfkVPIeZ9GicNzEGXm4TAGHmnSSicHH1Q9RkOPGSg4vKd0g' \
  -d 'user_role=users' \
  -d 'username=admin' \
  -d 'password=pass' \
  -d 'scope=openid api:oemr api:fhir user/Patient.read user/Patient.write user/Encounter.read user/Observation.read user/encounter.crus user/vital.crus user/patient.crus offline_access' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
```

Token expires in 3600 seconds (1 hour). Refresh token is also returned.

## 2. FHIR Patient POST (the only FHIR write route that matters)

**Critical**: The `name` array MUST include `"use": "official"` — OpenEMR's mapping
only extracts `fname`/`lname` from the name entry where `use === "official"`.

```bash
curl -sk -X POST https://localhost:9300/apis/default/fhir/Patient \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/fhir+json" \
  -d '{
    "resourceType": "Patient",
    "name": [{"use": "official", "family": "TestDog", "given": ["Rex"]}],
    "gender": "male",
    "birthDate": "2020-01-15"
  }'
```

Returns: `{"pid": 4, "uuid": "a17af49f-4202-4f65-abf6-d86932b08e38"}`

## 3. Standard API: Create Encounter

FHIR does NOT have a POST route for Encounter. Use the Standard API:

```bash
curl -sk -X POST "https://localhost:9300/apis/default/api/patient/${PATIENT_UUID}/encounter" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "date": "2026-04-06",
    "onset_date": "2026-04-06",
    "reason": "Office visit",
    "class_code": "AMB",
    "pc_catid": "5",
    "facility_id": "3",
    "billing_facility": "3",
    "sensitivity": "normal",
    "provider_id": "1"
  }'
```

Returns encounter with `euuid` field. Required scope: `user/encounter.crus`, ACL: `encounters/auth_a`.

## 4. Standard API: Create Vital / Observation

FHIR does NOT have a POST route for Observation. Use the Standard API:

```bash
curl -sk -X POST "https://localhost:9300/apis/default/api/patient/${PATIENT_UUID}/encounter/${ENCOUNTER_UUID}/vital" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bps": "120",
    "bpd": "80",
    "weight": "70",
    "height": "175",
    "temperature": "98.6",
    "temp_method": "Oral",
    "pulse": "72",
    "respiration": "16",
    "BMI": "22.9",
    "note": "Baseline vitals"
  }'
```

Returns HTTP 201 with `{"vid": N, "fid": N}`. Required scope: `user/vital.crus`, ACL: `encounters/notes`.

Vitals created via Standard API are automatically readable as FHIR Observations
(one vital record expands into ~15 individual LOINC-coded Observation resources).

## 5. FHIR Reads (all work)

```bash
# Patient
curl -sk https://localhost:9300/apis/default/fhir/Patient \
  -H "Authorization: Bearer $TOKEN"

# Encounter
curl -sk https://localhost:9300/apis/default/fhir/Encounter \
  -H "Authorization: Bearer $TOKEN"

# Observation
curl -sk https://localhost:9300/apis/default/fhir/Observation \
  -H "Authorization: Bearer $TOKEN"
```

## FHIR Write Limitations

Only 3 FHIR resources support POST in OpenEMR (as of current master):

| Resource | FHIR POST | Standard API POST |
|----------|-----------|-------------------|
| Patient | **Yes** | Yes (`/api/patient`) |
| Practitioner | Yes | N/A |
| Organization | Yes | N/A |
| Encounter | **No** | **Yes** (`/api/patient/:puuid/encounter`) |
| Observation | **No** | **Yes** (`/api/patient/:puuid/encounter/:euuid/vital`) |
| QuestionnaireResponse | **No** (TODO in codebase) | No |

**Strategy for rade-v2**: Use FHIR for Patient creation + all reads. Use Standard API
(`api:oemr` scope) for Encounter and Observation writes.

## OpenEMR Config (verified)

| Setting | Value |
|---------|-------|
| `rest_api` | `1` (enabled) |
| `rest_fhir_api` | `1` (enabled) |
| `rest_system_scopes_api` | `1` (enabled) |
| `oauth_password_grant` | `3` (all roles) |
| `oauth_app_manual_approval` | `0` (provider/system apps need manual approval) |

## Test Data Created

| Resource | ID |
|----------|----|
| Patient "Rex TestDog" | `a17af49f-4202-4f65-abf6-d86932b08e38` |
| Encounter | `a17af4d8-29f7-4970-8c9a-62b0d03162ac` |
| Vitals | vid=2 (30 FHIR Observations) |
