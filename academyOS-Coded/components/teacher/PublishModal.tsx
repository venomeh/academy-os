"use client";

import Modal from "@/components/ui/Modal";

export default function PublishModal({
  entered,
  total,
  batchAverage,
  onCancel,
  onConfirm,
}: {
  entered: number;
  total: number;
  batchAverage: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title="Publish to parents?" onClose={onCancel} width={440}>
      <div style={{ padding: 22 }}>
        <p style={{ margin: 0, fontSize: "0.875rem", lineHeight: 1.55, color: "#4A463F" }}>
          {entered} of {total} students have an entry. Publishing makes these scores visible to the parents of those students immediately, and feeds the September remark drafts.
        </p>
        <div style={{ marginTop: 16, padding: "13px 15px", background: "#FAF9F6", border: "1px solid #EFEDE7", borderRadius: 10, fontSize: "0.8125rem", color: "#6B6660" }}>
          Parents will see each score next to the batch average of {batchAverage}. Absent-for-test students show as absent, not zero.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 18 }}>
          <button
            type="button"
            onClick={onCancel}
            style={{ flex: "1 1 120px", height: 42, background: "#FFFFFF", border: "1px solid #DDD9D0", borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
          >
            Keep as draft
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{ flex: "1 1 120px", height: 42, background: "#0D0D0D", color: "#F7F6F3", border: 0, borderRadius: 9, fontSize: "0.8125rem", fontWeight: 700, cursor: "pointer" }}
          >
            Publish results
          </button>
        </div>
      </div>
    </Modal>
  );
}
