$ErrorActionPreference = 'Stop'

# Gradle's test worker cannot load test classes from some non-ASCII Windows paths.
# Redirect only this test invocation; normal Capacitor builds keep app/build/outputs.
$env:PAPER_READER_ANDROID_BUILD_DIR = Join-Path ([IO.Path]::GetTempPath()) 'paper-reader-android-test-build'
$androidDir = Join-Path $PSScriptRoot '..\android'
& (Join-Path $androidDir 'gradlew.bat') -p $androidDir testDebugUnitTest --no-daemon --console=plain
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
