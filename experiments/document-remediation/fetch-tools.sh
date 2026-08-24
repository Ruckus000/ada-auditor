#!/usr/bin/env bash
# Reproduces vendor/ from pinned versions. Run once before the experiment.
#
# Versions are pinned rather than tracking latest: the whole point of the
# spike is a measurement, and a measurement against "whatever shipped today"
# cannot be compared to itself next week.
set -euo pipefail

PDFBOX_VERSION=3.0.8
VERAPDF_VERSION=1.30.2

cd "$(dirname "$0")"
mkdir -p vendor
cd vendor

if [ ! -f "pdfbox-app-${PDFBOX_VERSION}.jar" ]; then
  echo "fetching PDFBox ${PDFBOX_VERSION}"
  curl -sSL --fail -o "pdfbox-app-${PDFBOX_VERSION}.jar" \
    "https://repo1.maven.org/maven2/org/apache/pdfbox/pdfbox-app/${PDFBOX_VERSION}/pdfbox-app-${PDFBOX_VERSION}.jar"
fi

# veraPDF ships an IzPack installer rather than a runnable jar, so it needs a
# headless auto-install descriptor. Absolute installpath: IzPack resolves a
# relative one against its own working directory, not ours.
if [ ! -x "verapdf/verapdf" ]; then
  echo "fetching veraPDF ${VERAPDF_VERSION}"
  curl -sSL --fail -o verapdf-installer.zip "https://software.verapdf.org/releases/verapdf-installer.zip"
  unzip -o -q verapdf-installer.zip -d verapdf-installer

  cat > auto-install.xml <<XML
<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<AutomatedInstallation langpack="eng">
  <com.izforge.izpack.panels.htmlhello.HTMLHelloPanel id="welcome"/>
  <com.izforge.izpack.panels.target.TargetPanel id="install_dir">
    <installpath>$(pwd)/verapdf</installpath>
  </com.izforge.izpack.panels.target.TargetPanel>
  <com.izforge.izpack.panels.packs.PacksPanel id="sdk_pack_select">
    <pack index="0" name="veraPDF GUI" selected="true"/>
    <pack index="1" name="veraPDF Batch files" selected="true"/>
    <pack index="2" name="veraPDF Validation model" selected="false"/>
    <pack index="3" name="veraPDF Documentation" selected="false"/>
    <pack index="4" name="veraPDF Sample Plugins" selected="false"/>
  </com.izforge.izpack.panels.packs.PacksPanel>
  <com.izforge.izpack.panels.install.InstallPanel id="install"/>
  <com.izforge.izpack.panels.finish.SimpleFinishPanel id="finish"/>
</AutomatedInstallation>
XML

  java -jar "verapdf-installer/verapdf-greenfield-${VERAPDF_VERSION}/verapdf-izpack-installer-${VERAPDF_VERSION}.jar" auto-install.xml
fi

echo "vendor/ ready"
