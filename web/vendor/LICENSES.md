# Vendored codec licences

These files are self-hosted builds of open-source encoders, bundled from the
[jSquash](https://github.com/jamsinclair/jSquash) project (Apache-2.0 / MIT),
which packages the [Squoosh](https://github.com/GoogleChromeLabs/squoosh)
codecs (Apache-2.0, Google LLC):

| File | Project | Version | Licence |
| --- | --- | --- | --- |
| `mozjpeg.js`, `mozjpeg_enc.wasm` | @jsquash/jpeg → [mozjpeg](https://github.com/mozilla/mozjpeg) | @jsquash/jpeg 1.6.0 | Apache-2.0 glue; mozjpeg is BSD-3-Clause/IJG |
| `oxipng.js`, `squoosh_oxipng_bg.wasm` | @jsquash/oxipng → [oxipng](https://github.com/shssoichiro/oxipng) | @jsquash/oxipng 2.3.0 | Apache-2.0 glue; oxipng is MIT |
| `avif.js`, `avif_enc.wasm` | @jsquash/avif → [libaom](https://aomedia.googlesource.com/aom/) | @jsquash/avif 2.1.1 | Apache-2.0 glue; libaom is BSD-2-Clause + AOM Patent License 1.0 |
| `webp.js`, `webp_enc_simd.wasm` | @jsquash/webp → [libwebp](https://chromium.googlesource.com/webm/libwebp) | @jsquash/webp 1.5.0 | Apache-2.0 glue; libwebp is BSD-3-Clause |

Versions confirmed 2026-10-15: each `.wasm` below is byte-identical (same
SHA-256) to the file of the same name in that version's npm tarball
(`npm pack @jsquash/<name>@<version>`).

No modifications were made to the codecs; the `.js` glue files are esbuild
IIFE bundles of the packages' published ES modules.

## Pinned builds

Vendored 2026-08-05 from the then-current @jsquash npm releases. If an
advisory lands against jSquash or an upstream codec, these hashes are how to
tell whether the shipped builds are the affected ones. Recompute with
`Get-FileHash -Algorithm SHA256` (or `sha256sum`); any change to these files
must update this table in the same commit.

| SHA-256 | File |
| --- | --- |
| `af50ac1b4e622b7441c26a98103f92fd7a8c549b6a8c6ee8535a3cebf4e12706` | `mozjpeg.js` |
| `24d4177f1c4963e2058b107189249651c61fdef125570e79b1dfb63c8bb49326` | `mozjpeg_enc.wasm` |
| `243e84f1e632e4f5d2b602ddf33e4987fb9e0a377369ba418d52413a1dbe3d35` | `oxipng.js` |
| `5ea3e53c0b4fc1b4e8d1511d35b89329d9376bec75a9c4d3c054774487e5f9a3` | `squoosh_oxipng_bg.wasm` |
| `8aecdb7782191a2e376a195b5038330c31636e327d48f52b5815fac375556723` | `avif.js` |
| `d9f2a95164362af48558d176e619becfd49dd97b50b86c679b47100860522b3d` | `avif_enc.wasm` |
| `ed231f933ddaa112b51ee4df8117b5fa4245ce1b370be0b2f8ef688f1f36c9e1` | `webp.js` |
| `39c279269ec1163b987b6d69749458e3d5b03b9585f58b6ca5455b76b504a305` | `webp_enc_simd.wasm` |

# Icons

The interface glyphs (inline `<svg>` in `index.html` and the select chevron
data URI in `css/base.css`) are from [Lucide](https://lucide.dev)
(ISC licence, © Lucide contributors), copied as plain SVG paths - no script,
no font, no requests.

# Fonts

The self-hosted faces in `web/fonts/` are subsets (latin, latin-ext; weights
400-600) of these families, from Google Fonts' builds. Neither family's
copyright notice declares a Reserved Font Name, so the subsets keep their
family names.

| Files | Family | Licence |
| --- | --- | --- |
| `instrument-serif-*.woff2` | Instrument Serif | SIL OFL 1.1 |
| `geist-mono-*.woff2` | Geist Mono | SIL OFL 1.1 |

Copyright 2022 The Instrument Serif Project Authors (https://github.com/Instrument/instrument-serif)

Copyright 2024 The Geist Project Authors (https://github.com/vercel/geist-font.git)

```
This Font Software is licensed under the SIL Open Font License, Version 1.1.
This license is copied below, and is also available with a FAQ at:
https://openfontlicense.org


-----------------------------------------------------------
SIL OPEN FONT LICENSE Version 1.1 - 26 February 2007
-----------------------------------------------------------

PREAMBLE
The goals of the Open Font License (OFL) are to stimulate worldwide
development of collaborative font projects, to support the font creation
efforts of academic and linguistic communities, and to provide a free and
open framework in which fonts may be shared and improved in partnership
with others.

The OFL allows the licensed fonts to be used, studied, modified and
redistributed freely as long as they are not sold by themselves. The
fonts, including any derivative works, can be bundled, embedded, 
redistributed and/or sold with any software provided that any reserved
names are not used by derivative works. The fonts and derivatives,
however, cannot be released under any other type of license. The
requirement for fonts to remain under this license does not apply
to any document created using the fonts or their derivatives.

DEFINITIONS
"Font Software" refers to the set of files released by the Copyright
Holder(s) under this license and clearly marked as such. This may
include source files, build scripts and documentation.

"Reserved Font Name" refers to any names specified as such after the
copyright statement(s).

"Original Version" refers to the collection of Font Software components as
distributed by the Copyright Holder(s).

"Modified Version" refers to any derivative made by adding to, deleting,
or substituting -- in part or in whole -- any of the components of the
Original Version, by changing formats or by porting the Font Software to a
new environment.

"Author" refers to any designer, engineer, programmer, technical
writer or other person who contributed to the Font Software.

PERMISSION & CONDITIONS
Permission is hereby granted, free of charge, to any person obtaining
a copy of the Font Software, to use, study, copy, merge, embed, modify,
redistribute, and sell modified and unmodified copies of the Font
Software, subject to the following conditions:

1) Neither the Font Software nor any of its individual components,
in Original or Modified Versions, may be sold by itself.

2) Original or Modified Versions of the Font Software may be bundled,
redistributed and/or sold with any software, provided that each copy
contains the above copyright notice and this license. These can be
included either as stand-alone text files, human-readable headers or
in the appropriate machine-readable metadata fields within text or
binary files as long as those fields can be easily viewed by the user.

3) No Modified Version of the Font Software may use the Reserved Font
Name(s) unless explicit written permission is granted by the corresponding
Copyright Holder. This restriction only applies to the primary font name as
presented to the users.

4) The name(s) of the Copyright Holder(s) or the Author(s) of the Font
Software shall not be used to promote, endorse or advertise any
Modified Version, except to acknowledge the contribution(s) of the
Copyright Holder(s) and the Author(s) or with their explicit written
permission.

5) The Font Software, modified or unmodified, in part or in whole,
must be distributed entirely under this license, and must not be
distributed under any other license. The requirement for fonts to
remain under this license does not apply to any document created
using the Font Software.

TERMINATION
This license becomes null and void if any of the above conditions are
not met.

DISCLAIMER
THE FONT SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO ANY WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT
OF COPYRIGHT, PATENT, TRADEMARK, OR OTHER RIGHT. IN NO EVENT SHALL THE
COPYRIGHT HOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY,
INCLUDING ANY GENERAL, SPECIAL, INDIRECT, INCIDENTAL, OR CONSEQUENTIAL
DAMAGES, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF THE USE OR INABILITY TO USE THE FONT SOFTWARE OR FROM
OTHER DEALINGS IN THE FONT SOFTWARE.
```
