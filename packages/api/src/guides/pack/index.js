// Pacote de guias da Lever (03/11/2026): os guias escritos no código, com os
// prints em arquivo (pasta prints/), instalados em qualquer ambiente pelo botão
// da tela Guias (guide-pack.js). Um arquivo por guia; mudar o conteúdo = subir
// a `version` do guia.
//
// Ordem = trilha de leitura do integrador (a tela numera nessa ordem, por
// sistema; guide-pack.js grava a posição em `order`): os comuns primeiro (a call
// e o cadastro), depois cada sistema na ordem em que aparece na call e então
// o resto do menu.

import callIntegracao from "./call-integracao.js";
import linkCadastro from "./link-cadastro.js";
import leverads0 from "./leverads-primeiro-acesso.js";
import leverads1 from "./leverads-contas.js";
import leverads2 from "./leverads-copiar.js";
import leverads3 from "./leverads-regras.js";
import leverads4 from "./leverads-editar.js";
import leverads5 from "./leverads-compatibilidades.js";
import leverads6 from "./leverads-criar-anuncio.js";
import leverads7 from "./leverads-sac.js";
import leverads8 from "./leverads-planilhas.js";
import leverads9 from "./leverads-vendas.js";
import leverads10 from "./leverads-usuarios.js";
import leverads11 from "./leverads-minha-conta.js";
import leverprice0 from "./leverprice-primeiro-acesso.js";
import leverprice1 from "./leverprice-produtos.js";
import leverprice2 from "./leverprice-anuncios.js";
import leverprice3 from "./leverprice-robo.js";
import leverprice4 from "./leverprice-inicio.js";
import leverprice5 from "./leverprice-pedidos.js";
import leverprice6 from "./leverprice-configuracoes.js";
import leverprice7 from "./leverprice-calculadora-relatorios.js";

export const GUIDE_PACK = [
  callIntegracao, linkCadastro,
  // LeverAds: primeiro acesso, contas e a 1ª cópia na call; depois o menu.
  leverads0, leverads1, leverads2, leverads3, leverads4, leverads5, leverads6, leverads7, leverads8, leverads9, leverads10, leverads11,
  // LeverPrice: primeiro acesso, custos, anúncios e o robô na call; depois o menu.
  leverprice0, leverprice1, leverprice2, leverprice3, leverprice4, leverprice5, leverprice6, leverprice7,
];
