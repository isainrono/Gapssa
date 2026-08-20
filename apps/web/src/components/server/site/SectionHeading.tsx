import styles from './SectionHeading.module.css'

type Props = {
  eyebrow: string
  title: string
  intro?: string
  dark?: boolean
  as?: 'h1' | 'h2'
}

export function SectionHeading({ eyebrow, title, intro, dark, as: Tag = 'h2' }: Props) {
  return (
    <div className={`${styles.wrapper} ${dark ? styles.dark : ''}`}>
      <p className={`eyebrow ${styles.eyebrowRow}`}>{eyebrow}</p>
      <Tag className={styles.title}>{title}</Tag>
      {intro ? <p className={styles.intro}>{intro}</p> : null}
    </div>
  )
}
