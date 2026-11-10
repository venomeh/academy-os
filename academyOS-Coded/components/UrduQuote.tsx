export default function UrduQuote() {
  return (
    <section className="sec sec--paper">
      <div className="wrap urdu">
        <p
          className="eyebrow"
          style={{ margin: 0, justifyContent: "center" }}
        >
          Overheard at the front desk
        </p>

        <blockquote style={{ margin: 0 }}>
          <p className="urdu__q" lang="ur" dir="rtl">
            فیس تو میں نے کب کی جمع کروا دی تھی!
          </p>
          <p className="urdu__sub" lang="ur" dir="rtl">
            ہر مہینے۔ ہر بچے کے ساتھ۔ اب رجسٹر نہیں، لیجر جواب دے گا۔
          </p>
        </blockquote>

        <div className="urdu__rule" />

        <p className="urdu__en">
          <b>“I paid that fee ages ago!”</b> — every month, every child. From
          now on the ledger answers that one, not your memory.
        </p>
      </div>
    </section>
  );
}
