<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Confirmación de Cita - GAPSSA</title>
</head>
<body style="margin: 0; padding: 0; background-color: #faf8f4; font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #1c1814; -webkit-font-smoothing: antialiased;">
    <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #faf8f4; padding: 40px 10px;">
        <tr>
            <td align="center">
                <!-- Container Card -->
                <table border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; border: 1px solid #e8dfd5; overflow: hidden; box-shadow: 0 4px 12px rgba(28, 24, 20, 0.05);">
                    
                    <!-- Header GAPSSA con Emblema Dorado -->
                    <tr>
                        <td align="center" style="background-color: #1c1814; padding: 32px 20px; border-bottom: 3px solid #c4a257;">
                            <!-- Emblema Monograma GAPSSA -->
                            <table border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto 14px auto;">
                                <tr>
                                    <td align="center" style="width: 56px; height: 56px; background-color: #28201a; border: 2px solid #c4a257; border-radius: 28px; text-align: center; vertical-align: middle;">
                                        <span style="font-family: Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: bold; color: #c4a257; line-height: 52px; display: block;">G</span>
                                    </td>
                                </tr>
                            </table>
                            <h1 style="margin: 0; font-family: Georgia, serif; font-size: 28px; font-weight: 400; color: #c4a257; letter-spacing: 4px; text-transform: uppercase;">GAPSSA</h1>
                            <p style="margin: 6px 0 0 0; font-size: 12px; color: #b0a498; letter-spacing: 2px; text-transform: uppercase;">Centro de Salud &amp; Bienestar</p>
                        </td>
                    </tr>

                    <!-- Body Content -->
                    <tr>
                        <td style="padding: 36px 32px;">
                            <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 600; color: #1c1814;">Appointment Confirmation</h2>
                            <p style="margin: 0 0 24px 0; font-size: 15px; line-height: 1.6; color: #5c5048;">
                                Estimado/a <strong>{{inviteeName}}</strong>,<br>
                                Here are the details of your upcoming appointment at GAPSSA:
                            </p>

                            <!-- Details Card -->
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #faf7f2; border: 1px solid #e8dfd5; border-radius: 8px; margin-bottom: 28px;">
                                <tr>
                                    <td style="padding: 20px;">
                                        <table border="0" cellpadding="0" cellspacing="0" width="100%">
                                            <tr>
                                                <td style="padding: 6px 0; font-size: 14px; color: #6b5f52; width: 120px; font-weight: 600;">Service:</td>
                                                <td style="padding: 6px 0; font-size: 14px; color: #1c1814; font-weight: 600;">{{name}}</td>
                                            </tr>
                                            <tr>
                                                <td style="padding: 6px 0; font-size: 14px; color: #6b5f52; font-weight: 600;">Date &amp; Time:</td>
                                                <td style="padding: 6px 0; font-size: 14px; color: #c4a257; font-weight: 700;">{{#if isAllDay}}{{dateStartFull}}{{else}}{{dateStartFull}} ({{timeZone}}){{/if}}</td>
                                            </tr>
                                            {{#if assignedUserName}}
                                            <tr>
                                                <td style="padding: 6px 0; font-size: 14px; color: #6b5f52; font-weight: 600;">Specialist:</td>
                                                <td style="padding: 6px 0; font-size: 14px; color: #1c1814;">{{assignedUserName}}</td>
                                            </tr>
                                            {{/if}}
                                            {{#if description}}
                                            <tr>
                                                <td style="padding: 6px 0; font-size: 14px; color: #6b5f52; font-weight: 600; vertical-align: top;">Notes:</td>
                                                <td style="padding: 6px 0; font-size: 14px; color: #5c5048;">{{{description}}}</td>
                                            </tr>
                                            {{/if}}
                                        </table>
                                    </td>
                                </tr>
                            </table>

                            <!-- Buttons -->
                            <p style="margin: 0 0 16px 0; font-size: 14px; color: #6b5f52; text-align: center;">Please confirm your attendance:</p>
                            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="margin-bottom: 24px;">
                                <tr>
                                    <td align="center">
                                        <table border="0" cellpadding="0" cellspacing="0">
                                            <tr>
                                                <td align="center" style="border-radius: 6px; background-color: #c4a257;">
                                                    <a href="{{acceptLink}}" style="font-size: 14px; font-weight: 600; color: #ffffff; text-decoration: none; display: inline-block; padding: 12px 24px; border-radius: 6px;">✓ Confirm Attendance</a>
                                                </td>
                                                <td width="12"></td>
                                                <td align="center" style="border-radius: 6px; border: 1px solid #9a8e84;">
                                                    <a href="{{declineLink}}" style="font-size: 14px; font-weight: 500; color: #5c5048; text-decoration: none; display: inline-block; padding: 11px 18px; border-radius: 6px;">Decline</a>
                                                </td>
                                            </tr>
                                        </table>
                                    </td>
                                </tr>
                            </table>

                            {{#if joinUrl}}
                            <p style="margin: 16px 0; text-align: center;">
                                <a href="{{joinUrl}}" style="font-size: 14px; font-weight: 600; color: #c4a257; text-decoration: underline;">Join online session</a>
                            </p>
                            {{/if}}

                            {{#if isUser}}
                            <div style="margin-top: 24px; padding-top: 16px; border-top: 1px dashed #e8dfd5; text-align: center;">
                                <a href="{{recordUrl}}" style="font-size: 13px; color: #7a6e64; text-decoration: underline;">View record in EspoCRM</a>
                            </div>
                            {{/if}}
                        </td>
                    </tr>

                    <!-- Footer -->
                    <tr>
                        <td style="background-color: #faf7f2; padding: 24px 32px; border-top: 1px solid #e8dfd5; text-align: center; font-size: 12px; color: #7a6e64; line-height: 1.5;">
                            <p style="margin: 0 0 8px 0; font-weight: 600; color: #1c1814;">GAPSSA &bull; Health &amp; Wellness Center</p>
                            <p style="margin: 0 0 8px 0;">Email: <a href="mailto:info@gapssa.es" style="color: #c4a257; text-decoration: none;">info@gapssa.es</a> | Web: <a href="https://gapssa.es" style="color: #c4a257; text-decoration: none;">www.gapssa.es</a></p>
                            <p style="margin: 0; font-size: 11px; color: #9a8e84;">If you have any questions or need to modify your appointment, please contact us.</p>
                        </td>
                    </tr>
                </table>
            </td>
        </tr>
    </table>
</body>
</html>