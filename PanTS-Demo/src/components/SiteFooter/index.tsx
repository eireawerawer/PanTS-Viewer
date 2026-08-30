import {
  CONTACT_LINK_TEXT,
  CONTACT_URL,
  FOOTER_INQUIRY_LEAD,
  FOOTER_TAGLINE,
  NONCLINICAL_WARNING,
} from "../../helpers/copy";
import styles from "./SiteFooter.module.css";

/**
 * Slim site-wide footer: tagline + the nonclinical notice on the left, the
 * inquiry route on the right. Strings live in helpers/copy.ts.
 */
function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.left}>
        <span className={styles.tagline}>{FOOTER_TAGLINE}</span>
        <span className={styles.notice}>{NONCLINICAL_WARNING}</span>
      </div>
      <span className={styles.partner}>
        {FOOTER_INQUIRY_LEAD}{" "}
        <a
          className={styles.link}
          href={CONTACT_URL}
          target="_blank"
          rel="noopener noreferrer"
        >
          {CONTACT_LINK_TEXT}
        </a>
        .
      </span>
    </footer>
  );
}

export default SiteFooter;
