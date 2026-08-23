#!/usr/bin/env sh
set -u

RESULTS_DIR=/workspace/allure-results
REPORT_DIR=/workspace/allure-report

mkdir -p "$RESULTS_DIR" "$REPORT_DIR"
find "$RESULTS_DIR" -mindepth 1 -delete
find "$REPORT_DIR" -mindepth 1 -delete

build_status=0
tests_status=0
report_status=0

npm run build || build_status=$?
ALLURE_RESULTS_DIR="$RESULTS_DIR" VITEST_SCRIPT=test:allure sh scripts/run-tests-in-parallel.sh || tests_status=$?
npx allure generate "$RESULTS_DIR" --output "$REPORT_DIR" --report-name "Home Economy test results" || report_status=$?

if [ "$build_status" -ne 0 ] || [ "$tests_status" -ne 0 ] || [ "$report_status" -ne 0 ]; then
  echo "Test pipeline failed: build=$build_status parallel_tests=$tests_status allure=$report_status" >&2
  exit 1
fi

echo "All test layers passed and the Allure report was generated."
