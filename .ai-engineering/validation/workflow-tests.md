# Workflow Test Cases

## Test 1: New Feature

Input: Add user profile settings.

Expected:

NEW → TRIAGED → ANALYZING → PLANNED → READY → BUILDING → REVIEW → QA → PR_READY

------------------------------------------------------------------------

## Test 2: Existing Feature

Input: Add feature that already exists.

Expected:

NEW → TRIAGED → ANALYZING → SKIPPED_ALREADY_IMPLEMENTED → REPORTED

------------------------------------------------------------------------

## Test 3: Missing Requirement

Input: Feature request without acceptance criteria.

Expected:

NEW → TRIAGED → BLOCKED_REQUIREMENT

------------------------------------------------------------------------

## Test 4: Security Change

Input: Change authentication.

Expected:

Architect review required. Human approval required.
