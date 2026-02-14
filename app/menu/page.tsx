import Image from "next/image";
import { displayMenu, type MenuPriceRow, type MenuSinglePriceRow } from "@/lib/display-menu";
import styles from "./menu.module.css";

const COLORS = {
  page: "#e7dbc4",
  panel: "#f4eee0",
  titleBar: "#c6533f",
  titleText: "#fff7ec",
  text: "#2f2a25",
  muted: "#7b5a47",
};

function SectionTitle({ title }: { title: string }) {
  return (
    <h2
      className={`mb-4 rounded-sm px-4 py-2 text-center text-2xl font-black uppercase ${styles.sectionTitle}`}
      style={{ backgroundColor: COLORS.titleBar, color: COLORS.titleText }}
    >
      {title}
    </h2>
  );
}

function TableSection({
  title,
  headers,
  rows,
}: {
  title: string;
  headers: readonly string[];
  rows: MenuPriceRow[];
}) {
  return (
    <section className="mb-6">
      <SectionTitle title={title} />
      <table className="w-full border-separate border-spacing-y-2 text-lg">
        <thead>
          <tr className={`text-right text-base uppercase ${styles.metaHeaderText}`} style={{ color: COLORS.muted }}>
            <th className="text-left">{""}</th>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.item} className={`font-semibold ${styles.bodyText}`} style={{ color: COLORS.text }}>
              <td className="py-1">{row.item}</td>
              {row.prices.map((price, i) => (
                <td key={`${row.item}-${i}`} className={`py-1 text-right ${styles.numberText}`}>
                  {price}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ListSection({
  title,
  rows,
}: {
  title: string;
  rows: MenuSinglePriceRow[];
}) {
  return (
    <section className="mb-6">
      <SectionTitle title={title} />
      <ul className={`space-y-3 text-lg font-semibold ${styles.bodyText}`} style={{ color: COLORS.text }}>
        {rows.map((row) => (
          <li key={row.item} className="flex items-center justify-between gap-4 border-b border-dotted pb-2">
            <span>{row.item}</span>
            <span className={styles.numberText}>{row.price}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function MenuPage() {
  return (
    <main
      className={`min-h-screen px-4 py-6 md:px-8 md:py-8 ${styles.menuRoot}`}
      style={{ backgroundColor: COLORS.page, color: COLORS.text }}
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-4 rounded-md p-6 text-center" style={{ backgroundColor: COLORS.panel }}>
          <Image src="/logo.png" alt="Dajaj logo" width={100} height={100} className="mx-auto mb-3 h-auto w-auto" />
          {/* <h1 className={`text-4xl font-black uppercase ${styles.displayTitle}`} style={{ color: COLORS.titleBar }}>
            {displayMenu.brand.name}
          </h1> */}
          <p className={`mt-1 text-xl font-extrabold uppercase ${styles.displayTitle}`} style={{ color: COLORS.titleBar }}>
            {displayMenu.brand.tagline}
          </p>
          <p className={`mt-3 text-base font-semibold ${styles.bodyText}`}>
            Catering Orders: <span className="font-black">{displayMenu.brand.cateringContact}</span>
          </p>
        </div>

        <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
          <div className="rounded-md p-6" style={{ backgroundColor: COLORS.panel }}>
            <TableSection title="Alfaham" headers={displayMenu.alfaham.headers} rows={displayMenu.alfaham.rows} />
            <ListSection title="Charcoal" rows={displayMenu.charcoal} />
            <TableSection title="Grill" headers={displayMenu.grill.headers} rows={displayMenu.grill.rows} />
          </div>

          <div className="rounded-md p-6" style={{ backgroundColor: COLORS.panel }}>
            <TableSection
              title="Khubbus Shawarma"
              headers={displayMenu.khubbusShawarma.headers}
              rows={displayMenu.khubbusShawarma.rows}
            />
            <p className={`-mt-2 mb-6 text-center text-base font-semibold ${styles.italicText}`} style={{ color: COLORS.titleBar }}>
              {displayMenu.khubbusShawarma.note}
            </p>
            <TableSection
              title="Rumali Shawarma"
              headers={displayMenu.rumaliShawarma.headers}
              rows={displayMenu.rumaliShawarma.rows}
            />
            <section className="mb-3">
              <SectionTitle title="Special Item" />
              <p className={`pt-2 text-center text-2xl font-black ${styles.bodyText}`} style={{ color: COLORS.text }}>
                {displayMenu.specialItem}
              </p>
            </section>
          </div>

          <div className="rounded-md p-6" style={{ backgroundColor: COLORS.panel }}>
            <TableSection
              title="Tandoor Special"
              headers={displayMenu.tandoorSpecial.headers}
              rows={displayMenu.tandoorSpecial.rows}
            />
            <ListSection title="Tandoori Kebab" rows={displayMenu.tandooriKebab} />
            <ListSection title="Tandoori Parathas" rows={displayMenu.tandooriParathas} />
            <TableSection
              title="Tandoor Breads"
              headers={displayMenu.tandoorBreads.headers}
              rows={displayMenu.tandoorBreads.rows}
            />
            <section>
              <SectionTitle title="Breads & Dips" />
              <div className={`grid grid-cols-1 gap-2 text-center text-base font-bold md:grid-cols-2 ${styles.bodyText}`}>
                {displayMenu.breadsAndDips.map((row) => (
                  <p key={row.item}>
                    {row.item}: <span className={styles.numberText}>{row.price}</span>
                  </p>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </main>
  );
}
