export const CODE_THEME_PATH = "/ojtrace/code.tmTheme";

export const MITEX_PACKAGE_KEY = "preview/mitex/0.2.5";

const CODE_THEME = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>name</key>
    <string>OJTrace Code</string>
    <key>settings</key>
    <array>
      <dict>
        <key>settings</key>
        <dict>
        </dict>
      </dict>
      <dict>
        <key>name</key>
        <string>Comment</string>
        <key>scope</key>
        <string>comment</string>
        <key>settings</key>
        <dict>
          <key>foreground</key>
          <string>#00ff00</string>
          <key>fontStyle</key>
          <string>italic</string>
        </dict>
      </dict>
      <dict>
        <key>name</key>
        <string>String</string>
        <key>scope</key>
        <string>string</string>
        <key>settings</key>
        <dict>
          <key>fontStyle</key>
          <string>bold</string>
        </dict>
      </dict>
      <dict>
        <key>name</key>
        <string>Keyword</string>
        <key>scope</key>
        <string>keyword</string>
        <key>settings</key>
        <dict>
          <key>foreground</key>
          <string>#bf0040</string>
          <key>fontStyle</key>
          <string>bold</string>
        </dict>
      </dict>
      <dict>
        <key>name</key>
        <string>Operator</string>
        <key>scope</key>
        <string>keyword.operator</string>
        <key>settings</key>
        <dict>
          <key>foreground</key>
          <string>#000000</string>
          <key>fontStyle</key>
          <string></string>
        </dict>
      </dict>
      <dict>
        <key>name</key>
        <string>Type</string>
        <key>scope</key>
        <string>storage.type</string>
        <key>settings</key>
        <dict>
          <key>foreground</key>
          <string>#000000</string>
          <key>fontStyle</key>
          <string></string>
        </dict>
      </dict>
      <dict>
        <key>name</key>
        <string>Include path</string>
        <key>scope</key>
        <string>string.quoted.other</string>
        <key>settings</key>
        <dict>
          <key>fontStyle</key>
          <string></string>
        </dict>
      </dict>
    </array>
  </dict>
</plist>
`;

export function codeThemeBytes(): Uint8Array {
  return new TextEncoder().encode(CODE_THEME);
}
