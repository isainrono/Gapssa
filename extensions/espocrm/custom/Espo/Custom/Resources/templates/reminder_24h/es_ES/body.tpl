<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Recordatorio de Cita - GAPSSA</title>
</head>
<body style="margin: 0; padding: 0; background-color: #faf8f4; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1c1814; -webkit-font-smoothing: antialiased;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #faf8f4; padding: 40px 10px;">
        <tr>
            <td align="center">
                <!-- Container Card -->
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e8dfd5; overflow: hidden; box-shadow: 0 4px 12px rgba(28, 24, 20, 0.05);">
                    
                    <!-- Header GAPSSA con Logotipo Oficial Completo en Fondo Claro -->
                    <tr>
                        <td align="center" style="background-color: #faf8f4; padding: 36px 20px 28px 20px; border-bottom: 2px solid #c4a257;">
                            <a href="https://gapssa.es" target="_blank" style="text-decoration: none; display: inline-block;">
                                <img src="https://gapssa.es/images/marca/logo-email.png" alt="GAPSSA by Nana" width="220" height="159" style="display: block; width: 220px; height: 159px; max-width: 100%; height: auto; border: 0; outline: none; text-decoration: none; margin: 0 auto;" />
                            </a>
                        </td>
                    </tr>

                    <!-- Body Content -->
                    <tr>
                        <td style="padding: 36px 32px;">
                            <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #1c1814;">Recordatorio: Mañana es su Cita</h2>
                            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #5c5048;">
                                Estimado/a <strong>{{inviteeName}}</strong>,<br>
                                Le recordamos que <strong>mañana</strong> tiene programada su sesión en GAPSSA. Todo nuestro equipo está listo para ofrecerle un momento exclusivo de cuidado y bienestar:
                            </p>

                            <!-- Details Card -->
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #faf7f2; border: 1px solid #e8dfd5; border-radius: 8px; margin-bottom: 20px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td style="padding: 6px 0; font-size: 14px; color: #6b5f52; width: 120px; font-weight: 600;">Tratamiento:</td>
                                                <td style="padding: 6px 0; font-size: 14px; color: #1c1814; font-weight: 600;">{{name}}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 6px 0; font-size: 14px; color: #6b5f52; font-weight: 600;">Fecha y hora:</td>
                                                <td style="padding: 6px 0; font-size: 14px; color: #c4a257; font-weight: 700;">{{dateStartFull}}</td>
                                            </tr>
                                            {{#if assignedUserName}}
                                            <tr>
                                                <td style="padding: 6px 0; font-size: 14px; color: #6b5f52; font-weight: 600;">Especialista:</td>
                                                <td style="padding: 6px 0; font-size: 14px; color: #1c1814;">{{assignedUserName}}</td>
                                            </tr>
                                            {{/if}}
                                            {{#if description}}
                                            <tr>
                                                <td style="padding: 6px 0; font-size: 14px; color: #6b5f52; font-weight: 600; vertical-align: top;">Notas:</td>
                                                <td style="padding: 6px 0; font-size: 14px; color: #5c5048;">{{{description}}}</td>
                                            </tr>
                                            {{/if}}
                                        </table>
                                    </td>
                                </tr>
                            </table>

                            <!-- Tip Box -->
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #fdfbf7; border-left: 3px solid #c4a257; border-radius: 4px; margin-bottom: 24px;">
                                <tr>
                                    <td style="padding: 12px 16px; font-size: 13px; line-height: 1.5; color: #6b5f52;">
                                        🌿 <strong>Recomendación:</strong> Le sugerimos llegar 5 minutos antes de la hora acordada para comenzar su tratamiento puntualmente y en total tranquilidad.
                                    </td>
                                </tr>
                            </table>

                            <!-- WhatsApp Assistance Card -->
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f0fbf4; border: 1px solid #bcead0; border-radius: 8px; margin-bottom: 24px;">
                                <tr>
                                    <td style="padding: 18px 20px;">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td style="font-size: 14px; line-height: 1.5; color: #1f5132;">
                                                    <strong style="font-size: 15px; color: #155724; display: block; margin-bottom: 6px;">¿Necesita consultar o reprogramar?</strong>
                                                    Si le ha surgido algún imprevisto, le agradecemos comunicarse directamente a nuestro WhatsApp oficial para reubicar su espacio:
                                                    <div style="margin-top: 12px;">
                                                        <a href="https://wa.me/34680373663" style="display: inline-block; background-color: #25d366; color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; padding: 10px 20px; border-radius: 6px; letter-spacing: 0.3px;">
                                                            💬 Contactar por WhatsApp (+34 680 373 663)
                                                        </a>
                                                    </div>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>

                            <!-- Portal Link -->
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px;">
                                <tr>
                                    <td align="center">
                                        <table border="0" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td align="center" style="border-radius: 6px; background-color: #c4a257;">
                                                    <a href="https://gapssa.es" style="font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; display: inline-block; padding: 12px 28px; border-radius: 6px;">Ver en Portal GAPSSA</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #faf7f2; padding: 24px 32px; border-top: 1px solid #e8dfd5; text-align: center; font-size: 12px; color: #7a6e64; line-height: 1.6;">
                            <p style="margin: 0 0 6px 0; font-weight: 600; color: #1c1814; font-size: 13px;">GAPSSA by Nana &bull; Centro de Estética Integral</p>
                            <p style="margin: 0 0 6px 0; color: #5c5048;">Carrer de Gayarre 24, Entresuelo 2, 08014 Barcelona, España</p>
                            <p style="margin: 0 0 8px 0;">WhatsApp: <a href="https://wa.me/34680373663" style="color: #20ba5a; font-weight: 600; text-decoration: none;">+34 680 373 663</a> | Email: <a href="mailto:gapssabynana@gmail.com" style="color: #c4a257; text-decoration: none;">gapssabynana@gmail.com</a> | Web: <a href="https://gapssa.es" style="color: #c4a257; text-decoration: none;">www.gapssa.es</a></p>
                            <p style="margin: 0; font-size: 11px; color: #9a8e84;">Le recordamos que las cancelaciones o cambios deben comunicarse con al menos 24 horas de antelación.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>
