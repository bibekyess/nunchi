# Fonts

Self-hosted so the app works offline and on networks that block font CDNs.

| File                                                                                          | Source                                                                          | License                                                      |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `Satoshi-Regular.woff2`, `Satoshi-Italic.woff2`, `Satoshi-Medium.woff2`, `Satoshi-Bold.woff2` | [Fontshare](https://www.fontshare.com/fonts/satoshi) by Indian Type Foundry     | ITF Free Font License (free for personal and commercial use) |
| `PretendardVariable.woff2`                                                                    | [Pretendard v1.3.9](https://github.com/orioncactus/pretendard) by Kil Hyung-jin | SIL Open Font License 1.1, see `Pretendard-LICENSE.txt`      |

Satoshi has no Hangul, so `app/globals.css` limits it to Latin with `unicode-range` and
Korean text falls through to Pretendard.
