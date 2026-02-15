import Link from "next/link";
import Image from "next/image";
import styles from "./menu/menu.module.css";

const COLORS = {
  page: "#e7dbc4",
  panel: "#f4eee0",
  titleBar: "#c6533f",
  titleText: "#fff7ec",
  text: "#2f2a25",
};

const MAPS_URL = "https://maps.app.goo.gl/NGaUPwQMD8P2UDbk9?g_st=ic";

export default function Home() {
  return (
    <main
      className={`min-h-screen px-4 py-6 md:px-8 md:py-8 ${styles.menuRoot}`}
      style={{ backgroundColor: COLORS.page, color: COLORS.text }}
    >
      <div className="mx-auto flex min-h-[85vh] max-w-4xl items-center justify-center">
        <section className="w-full rounded-md p-8 text-center md:p-10" style={{ backgroundColor: COLORS.panel }}>
          <Image src="/logo.png" alt="Dajaj logo" width={120} height={120} className="mx-auto mb-4 h-auto w-auto" />
          <p className={`mt-2 text-2xl uppercase ${styles.displayTitle}`} style={{ color: COLORS.titleBar }}>
            The Spice of Spices
          </p>

          <div className="mt-10 grid grid-cols-1 gap-5 md:grid-cols-2">
            <Link
              href={MAPS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={`block rounded-md px-6 py-8 text-2xl uppercase transition hover:opacity-95 ${styles.sectionTitle}`}
              style={{ backgroundColor: COLORS.titleBar, color: COLORS.titleText }}
            >
              Google Maps Location
            </Link>
            <Link
              href="/menu"
              className={`block rounded-md px-6 py-8 text-2xl uppercase transition hover:opacity-95 ${styles.sectionTitle}`}
              style={{ backgroundColor: COLORS.titleBar, color: COLORS.titleText }}
            >
              Menu
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}
