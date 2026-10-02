#!/usr/bin/env python3
import hashlib
import json
import os
import plistlib
import re
import sys
from collections import Counter

PROJECT_DATA_MAGIC = bytes.fromhex("2347c0ab")

METADATA_KEYS = (
    "BeatsPerMinute",
    "SampleRate",
    "NumberOfTracks",
    "SongKey",
    "SongGenderKey",
    "SongSignatureNumerator",
    "SongSignatureDenominator",
    "HasARAPlugins",
    "isTimeCodeBased",
    "SurroundFormatIndex",
    "Version",
)

METADATA_FILE_LISTS = (
    "AudioFiles",
    "UnusedAudioFiles",
    "SamplerInstrumentsFiles",
    "QuicksamplerFiles",
    "UltrabeatFiles",
    "ImpulsResponsesFiles",
    "PlaybackFiles",
    "VideoFiles",
)

PROJECT_INFO_KEYS = ("LastSavedFrom", "BundleVersion", "VariantNames", "HasProjectFolder")

REVERSED_TAGS = (b"gnoS", b"karT", b"qeSM", b"qSvE", b"gRuA", b"LFUA", b"lFuA", b"UCuA", b"tSnI", b"ivnE")

AU_TYPES = {b"umua": "aumu", b"xfua": "aufx", b"fmua": "aumf", b"imua": "aumi"}

PRINTABLE = re.compile(rb"^[\x20-\x7e]{4}$")


def snapshot(root):
    state = {}
    for directory, _, files in os.walk(root):
        for name in files:
            path = os.path.join(directory, name)
            info = os.stat(path)
            with open(path, "rb") as handle:
                digest = hashlib.sha256(handle.read()).hexdigest()
            state[os.path.relpath(path, root)] = (info.st_size, info.st_mtime_ns, digest)
    return state


def read_plist(path):
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as handle:
        try:
            return plistlib.load(handle)
        except Exception as error:
            return {"_error": f"{type(error).__name__}: {error}"}


def summarise_metadata(metadata):
    if metadata is None:
        return None
    if "_error" in metadata:
        return metadata
    summary = {key: metadata[key] for key in METADATA_KEYS if key in metadata}
    summary["fileLists"] = {
        key: [os.path.basename(str(item)) for item in metadata[key]]
        for key in METADATA_FILE_LISTS
        if isinstance(metadata.get(key), list) and metadata[key]
    }
    summary["unrecognisedKeys"] = sorted(
        key for key in metadata if key not in METADATA_KEYS and key not in METADATA_FILE_LISTS
    )
    return summary


def find_audio_unit_triples(data):
    found = Counter()
    for stored, display in AU_TYPES.items():
        for match in re.finditer(re.escape(stored), data):
            start = match.start()
            if start < 4 or start + 8 > len(data):
                continue
            manufacturer = data[start - 4 : start]
            subtype = data[start + 4 : start + 8]
            if PRINTABLE.match(manufacturer) and PRINTABLE.match(subtype):
                found[f"{display}/{subtype[::-1].decode()}/{manufacturer[::-1].decode()}"] += 1
    return dict(sorted(found.items()))


def summarise_project_data(path):
    if not os.path.isfile(path):
        return None
    with open(path, "rb") as handle:
        data = handle.read()
    return {
        "bytes": len(data),
        "magicMatches": data[:4] == PROJECT_DATA_MAGIC,
        "firstBytesHex": data[:16].hex(),
        "reversedTagCounts": {tag.decode(): data.count(tag) for tag in REVERSED_TAGS if tag in data},
        "audioUnitTriples": find_audio_unit_triples(data),
        "stockPluginAnchorCount": data.count(b"GAME"),
    }


def inspect_bundle(bundle):
    info = read_plist(os.path.join(bundle, "Resources", "ProjectInformation.plist"))
    alternatives_dir = os.path.join(bundle, "Alternatives")
    alternatives = sorted(os.listdir(alternatives_dir)) if os.path.isdir(alternatives_dir) else []
    return {
        "bundle": os.path.basename(os.path.normpath(bundle)),
        "projectInformation": (
            {key: info[key] for key in PROJECT_INFO_KEYS if key in info} if isinstance(info, dict) else None
        ),
        "alternatives": {
            name: {
                "metadata": summarise_metadata(read_plist(os.path.join(alternatives_dir, name, "MetaData.plist"))),
                "projectData": summarise_project_data(os.path.join(alternatives_dir, name, "ProjectData")),
            }
            for name in alternatives
            if re.fullmatch(r"\d{3}", name)
        },
    }


def main(argv):
    if len(argv) != 2 or not os.path.isdir(argv[1]):
        print("usage: inspect_logicx.py <path/to/Project.logicx>", file=sys.stderr)
        return 2
    bundle = argv[1]
    before = snapshot(bundle)
    report = inspect_bundle(bundle)
    after = snapshot(bundle)
    report["readOnlyCheck"] = "unchanged" if before == after else "CHANGED"
    print(json.dumps(report, indent=2, default=str))
    return 0 if before == after else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
