# Image ID Generator (Registry)

5-char base-36 lowercase universal handle generation (INV-3). Called at Card 2 (post-ESIGN ISA) when an image is admitted into the system. Pure function; uniqueness verified at insert time via `images.image_id` UNIQUE constraint.

## 1. Interface

### 1.1 Inputs

#### generate
No inputs.

### 1.2 Outputs

#### generate
| Field | Type | Notes |
|---|---|---|
| image_id | string | 5-char `[0-9a-z]` (e.g., `"abc1d"`) |

### 1.3 Error Codes

None at the generator itself. Caller handles uniqueness collisions by retry.

### 1.4 Pre / Post Conditions

| Type | Condition |
|---|---|
| Post | returned string matches `/^[0-9a-z]{5}$/` |

### 1.5 Acceptance Criteria

| ID | Given | When | Then |
|---|---|---|---|
| AC-01 | called | `generate()` | returns 5-char lowercase string in `[0-9a-z]` |
| AC-02 | called repeatedly | many calls | distribution is uniform across base-36 |

## 2. Functional Requirements

### 2.1 Generation
5 random bytes via `node:crypto.randomBytes`; each mapped into base-36 alphabet (`0-9a-z`). 36^5 = 60,466,176 possible ids -- collision rate at MVP scale (hundreds of images) is negligible.

### 2.2 Uniqueness
Verified at insert time via `images.image_id` UNIQUE constraint. On collision (rare), caller retries `generate()` up to 5 times before surfacing the error upstream.

### 2.3 INV-3 Compliance
Canonical home for image-ID creation. Certification (Card 2) calls into here; Commerce consumes the id; Registry owns the primitive.

## 3. Architecture
Pure function. No DB calls in the generator itself. Stateless.

## 4. Non-Functional Requirements

| Property | Specification |
|---|---|
| Latency | <= 1 ms |
| Determinism | random; uniqueness retried at caller |

## 5. Dependencies

| Dependency | Role |
|---|---|
| `node:crypto.randomBytes` | entropy source |
| `images.image_id` UNIQUE constraint (Prisma) | uniqueness enforcement at caller |

## 6. Open Issues

| ID | Issue |
|---|---|
| OI-01 | At MMP scale (>1M images), birthday-paradox collision rate increases; consider bumping to 6 chars |
| OI-02 | Reserved-word / profanity filter (e.g., reject ids that spell offensive words) -- deferred |

## 7. Cross-References

| Doc | Purpose |
|---|---|
| R71 §2.2 step 8 | Card 2 image-id assignment |
| R62 §2.3 | 5-char base-36 handle definition |
| Constitution INV-3 | image-ID is Registry-owned |

---
*Last Updated: 05/29/26 17:00*
