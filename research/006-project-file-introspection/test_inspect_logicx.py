import contextlib
import io
import os
import plistlib
import tempfile
import unittest

import inspect_logicx


def make_bundle(root):
    bundle = os.path.join(root, "Synthetic.logicx")
    alternative = os.path.join(bundle, "Alternatives", "000")
    os.makedirs(alternative)
    os.makedirs(os.path.join(bundle, "Resources"))
    with open(os.path.join(bundle, "Resources", "ProjectInformation.plist"), "wb") as handle:
        plistlib.dump({"LastSavedFrom": "Synthetic 1.0", "VariantNames": {"0": "Synthetic"}}, handle, fmt=plistlib.FMT_BINARY)
    with open(os.path.join(alternative, "MetaData.plist"), "wb") as handle:
        plistlib.dump(
            {
                "BeatsPerMinute": 98.0,
                "SampleRate": 48000,
                "NumberOfTracks": 3,
                "SongKey": "A",
                "SongGenderKey": "minor",
                "AudioFiles": ["/Users/someone/Music/Song/Audio Files/Vox_01.wav"],
                "SomethingNew": True,
            },
            handle,
            fmt=plistlib.FMT_BINARY,
        )
    project_data = (
        inspect_logicx.PROJECT_DATA_MAGIC
        + b"\x00" * 12
        + b"gnoS"
        + b"karT" * 2
        + b"\x00lppA"
        + b"xfua"
        + b"pmoC"
        + b"\x00\xff\xfe\x01"
        + b"xfua"
        + b"GAME"
        + b"\x01\x02"
    )
    with open(os.path.join(alternative, "ProjectData"), "wb") as handle:
        handle.write(project_data)
    return bundle


class InspectLogicxTest(unittest.TestCase):
    def test_reports_metadata_project_info_and_project_data(self):
        with tempfile.TemporaryDirectory() as root:
            report = inspect_logicx.inspect_bundle(make_bundle(root))
        self.assertEqual(report["projectInformation"]["LastSavedFrom"], "Synthetic 1.0")
        alternative = report["alternatives"]["000"]
        metadata = alternative["metadata"]
        self.assertEqual(metadata["BeatsPerMinute"], 98.0)
        self.assertEqual(metadata["SampleRate"], 48000)
        self.assertEqual(metadata["SongKey"], "A")
        self.assertEqual(metadata["fileLists"], {"AudioFiles": ["Vox_01.wav"]})
        self.assertEqual(metadata["unrecognisedKeys"], ["SomethingNew"])
        project_data = alternative["projectData"]
        self.assertTrue(project_data["magicMatches"])
        self.assertEqual(project_data["reversedTagCounts"], {"gnoS": 1, "karT": 2})
        self.assertEqual(project_data["audioUnitTriples"], {"aufx/Comp/Appl": 1})
        self.assertEqual(project_data["stockPluginAnchorCount"], 1)

    def test_missing_files_are_reported_as_none(self):
        with tempfile.TemporaryDirectory() as root:
            bundle = os.path.join(root, "Empty.logicx")
            os.makedirs(os.path.join(bundle, "Alternatives", "000"))
            report = inspect_logicx.inspect_bundle(bundle)
        self.assertIsNone(report["projectInformation"])
        self.assertEqual(report["alternatives"]["000"], {"metadata": None, "projectData": None})

    def test_main_leaves_bundle_unchanged(self):
        with tempfile.TemporaryDirectory() as root:
            bundle = make_bundle(root)
            before = inspect_logicx.snapshot(bundle)
            with contextlib.redirect_stdout(io.StringIO()):
                status = inspect_logicx.main(["inspect_logicx.py", bundle])
            self.assertEqual(status, 0)
            self.assertEqual(inspect_logicx.snapshot(bundle), before)


if __name__ == "__main__":
    unittest.main()
