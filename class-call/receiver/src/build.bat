@echo off
rem Builds ..\Receiver.exe with the C# compiler that ships with Windows (.NET Framework 4.x).
set FW=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319
set SPEECH=%WINDIR%\Microsoft.NET\assembly\GAC_MSIL\System.Speech\v4.0_4.0.0.0__31bf3856ad364e35\System.Speech.dll
"%FW%\csc.exe" /nologo /target:winexe /optimize+ /codepage:65001 /out:"%~dp0..\Receiver.exe" /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.Web.Extensions.dll /r:"%SPEECH%" "%~dp0Receiver.cs"
if errorlevel 1 (echo Build failed.) else (echo Built: %~dp0..\Receiver.exe)
