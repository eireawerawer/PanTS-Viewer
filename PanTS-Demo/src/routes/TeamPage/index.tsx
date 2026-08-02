import { useState } from "react";
import { preload } from "react-dom";
import Header from "../../components/Header";
import styles from "./TeamPage.module.css";

// Every card in this grid sits above the fold on a normal screen, so lazy loading
// buys nothing here and in practice broke the page: the lazy avatars were never
// fetched at all and rendered as empty grey circles. Load the first screenful
// eagerly and only lazy-load members beyond it, so the page still scales if the
// team grows.
const EAGER_COUNT = 6;

type Member = { name: string; role: string; photo?: string };

// preload only the first member's photo to ensure it loads quickly, improving performance.
const ZHOU_PHOTO = "/headshots/zongwei-zhou.webp";
preload(ZHOU_PHOTO, { as: "image", fetchPriority: "high" });

// .webp images are used for better compression and faster loading times. Also, be sure to use small image sizes.
const MEMBERS: Member[] = [
  {
    name: "Zongwei Zhou, PhD",
    role: "Principal Investigator",
    photo: ZHOU_PHOTO,
  },
  {
    name: "Alan L. Yuille, PhD",
    role: "Scientific Advisor",
    photo: "/headshots/alan-yuille.webp",
  },
  {
    name: "Wenxuan Li",
    role: "PhD Student",
    photo: "/headshots/wenxuan-li.webp",
  },
  {
    name: "Pedro RAS Bassi",
    role: "PhD Student",
    photo: "/headshots/pedro-bassi.webp",
  },
  { name: "Jaeden Pangaribuan", role: "Core Contributor" },
  {
    name: "Lucy Wu",
    role: "Core Contributor",
    photo: "/headshots/lucy-wu.webp",
  },
];

function Avatar({
  photo,
  name,
  priority,
}: {
  photo?: string;
  name: string;
  priority?: boolean;
}) {
  // If a headshot is missing or fails to load, fall back to the placeholder
  // silhouette rather than leaving an empty grey circle.
  const [failed, setFailed] = useState(false);

  return (
    <div className={styles.avatarRing}>
      <div className={styles.avatarInner}>
        {photo && !failed ? (
          <img
            src={photo}
            alt={name}
            width={120}
            height={120}
            className={styles.avatarImg}
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "high" : "auto"}
            decoding="async"
            onError={() => setFailed(true)}
          />
        ) : (
          <svg
            width="68%"
            height="68%"
            viewBox="0 0 24 24"
            fill="#b3b3b3"
            aria-hidden="true"
          >
            <circle cx="12" cy="9" r="4.2" />
            <path d="M4.5 21c0-3.7 3.4-6.2 7.5-6.2s7.5 2.5 7.5 6.2z" />
          </svg>
        )}
      </div>
    </div>
  );
}

function MemberCard({
  member,
  priority,
}: {
  member: Member;
  priority?: boolean;
}) {
  return (
    <div className={styles.card}>
      <Avatar photo={member.photo} name={member.name} priority={priority} />
      <div>
        <div className={styles.memberName}>{member.name}</div>
        <div className={styles.memberRole}>{member.role}</div>
      </div>
    </div>
  );
}

export default function TeamPage() {
  return (
    <div className={styles.page}>
      <Header />
      <main className={styles.main}>
        <h1 className={styles.title}>
          Meet the <span className={styles.titleBold}>team.</span>
        </h1>
        <ul className={styles.grid}>
          {MEMBERS.map((m, i) => (
            <li key={m.name}>
              <MemberCard member={m} priority={i < EAGER_COUNT} />
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
