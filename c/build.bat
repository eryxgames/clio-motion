@echo off
rem CLIo Motion's shared library with Microsoft's compiler, from a Developer Command Prompt (x64, or x64 to ARM64):
rem   build.bat        builds build\clio_motion.dll
rem /fp:strict keeps the floats as the reference rounds them (no fused multiply-add).
if not exist build mkdir build
cl /nologo /O2 /fp:strict /W3 /LD /DCM_BUILD /I. clio_motion.c clio_motion_ground.c clio_motion_body.c clio_motion_characters.c clio_motion_rig.c clio_motion_rigs.c clio_motion_api.c /Fobuild\ /Fe:build\clio_motion.dll || exit /b 1
