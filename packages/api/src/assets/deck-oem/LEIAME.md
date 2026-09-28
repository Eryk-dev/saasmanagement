# Prints do anúncio padrão (deck de criação de anúncios · OEM)

Imagens servidas pela API em `/public/deck/oem/<arquivo>` (rota em
`routes.proposals.js`) e usadas pela apresentação `proposal-oem-page.js`.

| arquivo | onde aparece |
| --- | --- |
| `anuncio.jpg` | slide 02, a página do anúncio no Mercado Livre |
| `foto-1.jpg` … `foto-5.jpg` | slide 03, as fotos do anúncio |
| `ficha.jpg` | slide 04, características do produto |
| `descricao-1.jpg` | slide 05, a descrição (primeira parte) |
| `descricao-2.jpg` | slide 05, a descrição (segunda parte) |

Print que faltar vira espaço reservado escrito no slide (`[print da …]`), nunca
imagem quebrada. Pra trocar os prints:

```sh
node packages/api/scripts/2026-09-28-prints-deck-oem.mjs ~/Downloads/oem-prints
```

O script redimensiona e renomeia na ordem alfabética da pasta de origem.
