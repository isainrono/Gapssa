import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { contactoConfigurado, getAjustesGlobales, googleMapsUrl } from '@/lib/content/ajustesGlobales'
import { publicEnv } from '@/lib/env.public'
import { getDictionary } from '@/lib/i18n/dictionary'
import { isLocale } from '@/lib/i18n/locales'
import { buildLocalizedMetadata } from '@/lib/seo/metadata'

import { SectionHeading } from '@/components/server/site/SectionHeading'

import styles from './Contacto.module.css'

type Args = {
  params: Promise<{ locale: string }>
}

export async function generateMetadata({ params }: Args): Promise<Metadata> {
  const { locale } = await params
  if (!isLocale(locale)) {
    return {}
  }
  const dict = getDictionary(locale)
  return buildLocalizedMetadata({ locale, path: 'contacto', title: dict.contacto.titulo }, publicEnv.NEXT_PUBLIC_SITE_URL)
}

export default async function ContactoPage({ params }: Args) {
  const { locale } = await params
  if (!isLocale(locale)) {
    notFound()
  }

  const dict = getDictionary(locale)
  const ajustes = await getAjustesGlobales(locale)
  const contacto = contactoConfigurado(ajustes)
  const mapsUrl = googleMapsUrl(ajustes)
  const direccionTexto = [ajustes.direccion?.calle, ajustes.direccion?.ciudad, ajustes.direccion?.codigoPostal]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="section container">
      <SectionHeading as="h1" eyebrow={dict.home.contactoEyebrow} title={dict.contacto.titulo} />

      <div className={styles.grid}>
        <div>
          <h2>{dict.contacto.visitanosTitulo}</h2>
          <ul className={styles.infoList}>
            {direccionTexto ? (
              <li className={styles.infoRow}>
                <div>
                  <p className={styles.infoLabel}>{dict.contacto.direccionLabel}</p>
                  <p className={styles.infoValue}>{direccionTexto}</p>
                </div>
              </li>
            ) : null}
            {contacto.telefono ? (
              <li className={styles.infoRow}>
                <div>
                  <p className={styles.infoLabel}>{dict.contacto.telefonoLabel}</p>
                  <a href={`tel:${contacto.telefono}`} className={styles.infoValue}>
                    {contacto.telefono}
                  </a>
                </div>
              </li>
            ) : null}
            {contacto.whatsapp ? (
              <li className={styles.infoRow}>
                <div>
                  <p className={styles.infoLabel}>{dict.contacto.whatsappLabel}</p>
                  <a
                    href={`https://wa.me/${contacto.whatsapp.replace(/\D/g, '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className={styles.infoValue}
                  >
                    {contacto.whatsapp}
                  </a>
                </div>
              </li>
            ) : null}
            {contacto.correoPublico ? (
              <li className={styles.infoRow}>
                <div>
                  <p className={styles.infoLabel}>{dict.contacto.correoLabel}</p>
                  <a href={`mailto:${contacto.correoPublico}`} className={styles.infoValue}>
                    {contacto.correoPublico}
                  </a>
                </div>
              </li>
            ) : null}
            {ajustes.horario && ajustes.horario.length > 0 ? (
              <li className={styles.infoRow}>
                <div>
                  <p className={styles.infoLabel}>{dict.contacto.horarioLabel}</p>
                  <ul className={styles.horarioList}>
                    {ajustes.horario.map((dia) => (
                      <li key={dia.id}>
                        {dict.dias[dia.dia]}: {dia.cerrado ? dict.contacto.cerrado : dia.franja}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ) : null}
          </ul>

          {mapsUrl ? (
            <div className={styles.mapCard}>
              <p>{direccionTexto}</p>
              <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className={styles.mapButton}>
                {dict.contacto.mapaAbrir}
              </a>
            </div>
          ) : null}
        </div>

        <div>
          <h2>{dict.contacto.formularioTitulo}</h2>
          <p className={styles.formAviso}>{dict.contacto.formularioAviso}</p>
          <div className={styles.form} aria-disabled="true">
            <input className={styles.field} type="text" placeholder={dict.contacto.formularioTitulo} disabled />
            <input className={styles.field} type="email" placeholder={dict.contacto.correoLabel} disabled />
            <textarea className={styles.field} rows={4} disabled />
          </div>
        </div>
      </div>
    </div>
  )
}
