# Лицензии моделей игры

Правило студии: контент — только из названного источника с правовым основанием (устав, `docs/06-content.md`, ADR студии
0012); графика ПК-игры может быть и из генераторов, но только по ADR студии 0020 — с журналом и одобрением владельца. **Здесь
генераторов нет**: только модели под **CC0 1.0** и своё (код). Откуда что — `docs/13-art.md`, §16.

**Люди** — копия набора «Больницы» (`Nefeste/bolnitsa`, `assets/models/people/` @ `e0a3491`, ADR студии 0002): те же
сжатые файлы побайтно, с той же записью источника и SHA-256 исходника и сжатого файла — ниже и в
`assets/models/sources.json`. Сжатые копии сделал инструмент «Больницы» `tools/app/assets.mjs`: у людей оставлены пять
анимаций из семнадцати — `Idle`, `Walk`, `Run`, `SitDown`, `StandUp`; геометрия и анимации сжаты EXT_meshopt_compression;
других правок нет. Из пятнадцати видов «Больницы» взяты тринадцать: «классика» (`OldClassy_*`) — в цилиндрах, на заводе
таких нет. Тест `tools/test/people.test.ts` сверяет файлы с `sources.json`. **Перед выпуском** набор надо скачать
заново со страницы автора и сверить по SHA-256. Где какая модель на заводе — `src/render/cast.ts`.

## 1. Ultimate Animated Character Pack (ноябрь 2019) — Quaternius

- **Автор:** Quaternius (Tomás Laulhé), https://quaternius.com.
- **Страница:** https://quaternius.com/packs/ultimatedanimatedcharacter.html — «License: CC0» (ссылка на
  https://creativecommons.org/publicdomain/zero/1.0/); «50+ different animated characters, with many animations! … free to
  use in personal and commercial projects».
- **`License.txt` в архиве (дословно):** «LowPoly Models by @Quaternius — License: CC0 1.0 Universal (CC0 1.0) Public Domain
  Dedication https://creativecommons.org/publicdomain/zero/1.0/».
- **Откуда файлы:** https://github.com/kimkichan1225/3DCommunity, папка `public/resources/Ultimate Animated Character Pack -
  Nov 2019/` (архив набора целиком, с `License.txt`), коммит `7a2464f7`; файлы — `glTF/<имя>.gltf` →
  `assets/models/people/<имя>.glb`. Официальная ссылка на скачивание (Google Drive со страницы автора) из контейнера
  недоступна.
- **Пропорции — мультяшные** (голова — около трети роста). Так же, как в «Больнице»: одетых людей обычных пропорций с
  анимациями под CC0 под рукой нет. Отрисовка от пропорций не зависит: рост и опора меряются по модели
  (`src/render/bake.ts`).

| Модель | Кто на заводе | SHA-256 исходника | SHA-256 сжатого файла |
|---|---|---|---|
| `Doctor_Male_Young` | лаборатория, качество, производство и упаковка (халат или комбинезон — цвет по роли) | `4f39182b6ecff6affac27f7c4cb2abf9529d68be4a77cc71343b40a83fe6e0cd` | `a5287a16a3735fcfc75b440218df747b58c63bd61338cccab4ca4f778fcb187f` |
| `Doctor_Female_Young` | то же | `2fd5082696aca804d77555eff96f6e07c11549e4f03661ce2467e2b9f881e5ab` | `677cfae07fd11baa18cdf24a6141b855f659f5ae6e9a23a249c2f11e85862029` |
| `Doctor_Male_Old` | то же | `882741dd558d5a4e91704c6ef88f2979f9c34d956f2da6ce83aca80e5f43a6ab` | `cad5beb6c8fa106894705726a4c725ace66c3b3211a22acd5b680c2cf9c5334b` |
| `Doctor_Female_Old` | то же | `7574bea268ed05f11bb1e4a16fdf36ab6302051b5514f20e12f4befb4c99b172` | `0aa4cd25132ce657ad673dec7df83d4d1b822a9aa2cc5d1de68e2ea194a9f936` |
| `Suit_Male` | уполномоченное лицо, начальник ОКК | `d89d245d10c81ee637116b3400657dad2873ec1bbfb7f90579b2f77a8779fa5b` | `e593798e03c68edd74bdba8861bcd4df0258d2f7865a665f881521a38cc0be62` |
| `Suit_Female` | то же | `37cbe38d428f57aff788be0f585fb9892b6115cc014c494cb19ec65c621e1f07` | `20ee4b1b6812f70ec2e6aa98a6dfb2e489691607c89f1884ee683567f5ce7974` |
| `Casual_Male` | склад и техслужба (жилет или куртка — цвет по роли) | `db66b2424af60d7799760795ca63c8a5be1c8af64e9f134217f0a3ff9e405379` | `e1d4018b01f851c8236e0648a208bec24cb653a7e924bbd1fb995222dae7e721` |
| `Casual_Female` | то же | `87327963ab0f37d004c7340d130808727f3d67b724c3d41aad01fd63c7d6fc8a` | `3013a3e5cc765eaf1bd43a0e0e0bb67eb45ae948e3c93e29ab2b992862632857` |
| `Casual2_Male` | то же | `9e8f23af968979cc6945d11015d9fd3cb1e94d53c3b91c39cac39a80e7490a79` | `a83778988838e5e31282d0f258b9173b95f10438d964fce81ed3c66d0dde5cdf` |
| `Casual2_Female` | то же | `b614bfe01ae69e0d9dfdfb6ff74fb53abfcc32be59858a9b89fb05ffd3062324` | `ee38ad91991e33c655b729a82221391578ea5a44c5196e0eba8d8e27564800a3` |
| `Casual3_Male` | то же | `f84ec360f53796287cfdb6082ad82fd76464dc34845759ca7f1f2ee9e7604057` | `a93b5f2826ccb14007c4740e9247913fdba59c213091b78a786b50974dd45fc1` |
| `Casual3_Female` | то же | `75cb6d7fa20674cb6b1dc3ad4e3c6d0d1de03f0128817ba60dcc4fad4ca008a2` | `8be063ff5ebf3f753887364b813b880d5f495dd1f3d37b0627d674c7b8ace634` |
| `Casual_Bald` | склад и техслужба, старше (в наборе нет бега) | `a75e2ade5703cd02371d7f38bb6ab307d94a7db2f07d4a219f9248fdecab5e6a` | `1023a993fb3bc2e559dd1825514334cb8684adf51d0a28cf371f6d1c2b58c4f1` |

Правки при загрузке (в коде, `src/render/bake.ts` — копия «Больницы»): кожа у набора чёрная — красится тоном кожи
экземпляра; кожа выше глаз (под волосами) — в цвет волос; одежда (халат, рубашка) красится цветом экземпляра — по роли
(`src/render/cast.ts`); рост приведён к таблице `STATURE` (1,76 и 1,64 м, старшие — на 4 см ниже).

## 2. Своё — модели из Blender

С пилота [#109](https://github.com/Nefeste/pharma/issues/109), по решению владельца
[#112](https://github.com/Nefeste/pharma/issues/112): своё, без внешних файлов и без генераторов — Python-скрипты
`blender/` строят модели машин из их записей `content/` в Blender в фоновом режиме, все — в одном файле (устав,
`docs/11-new-games.md`, «Графика и звук из скриптов»). Права — полные, как у кода игры. Версия — **Blender 5.2.3 LTS**
(сборка `e13b728c6880`), запуск и повторяемость — `blender/README.md`. Паспорт каждого файла — в
`assets/models/sources.json`: скрипт, SHA-256 скриптов, SHA-256 доли сцены (запись и отделка, `tools/blender/scene.ts`),
версия Blender, SHA-256 файла; файлы повторяются байт в байт. Тест `tools/test/blender.test.ts` сверяет файлы с
паспортом, а паспорт — с нынешними записями и скриптами.

| Файл | Что | Скрипт | SHA-256 сцены | SHA-256 файла |
|---|---|---|---|---|
| `machines.glb` | машины из Blender — роторный пресс `eq.press`, блистерная `mach.blister`, картонажная `mach.cartoner`: узел машины — вид записи, внутри — узлы частей записи; материалы общие, затенение (AO) — внутри | `blender/machines.py` | `3004b108b7a5b334634f0d2b97fc22269547fa655832b407c281120352afa1fb` | `22ff977cf46b83d2908698bc299c7a433312c28a4f7b0f6b5bf030add11b14b0` |

## 3. Своё — код игры

Без внешних файлов, нарисовано кодом:

- **Здание:** полы и двор (`src/render/textures.ts`, 2D-холст), стены, окна, двери, ворота и рампы, светильники
  (`world.ts`, `doors.ts`, `lamps.ts`).
- **Склад:** стеллажи, паллеты и грузы (`loads.ts`), фуры (`trucks.ts`), рохля и ричтрак (`vehicles.ts`).
- **Оборудование и машины линии** — модели кодом из частей записи базы (`model`), лампы состояний со значками на
  2D-холсте, ленты и штуки на них (`machines.ts`).
- **Таблички помещений** — `signs.ts`.
