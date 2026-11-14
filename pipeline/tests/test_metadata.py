from pipeline import sources


def test_source_metadata_declares_measurement_context():
    required = {"resolution", "temporal_coverage", "data_quality", "uncertainty", "measurement_class"}
    for source, metadata in sources.SOURCE_METADATA.items():
        assert required <= metadata.keys(), source
        assert all(isinstance(metadata[key], str) and metadata[key] for key in required), source
