console.log("script.js loaded and running."); // Adicionado para depuração

let cardContainer = document.querySelector(".card-container");
let campoBusca = document.querySelector(".search-container input")
let btnBuscar = document.querySelector("#botao-busca"); // Corrigido para o ID correto do HTML
let dados = [];
let mapHud = document.getElementById("map-hud");
let mapaGeograficoSistemas = {}; // Armazenará a sobreposição real municípios <-> sistemas
let especieEmDetalhe = null; // Rastreia qual espécie está aberta nos detalhes
let ultimaBuscaTexto = ""; // Rastreia o último termo pesquisado para gerenciar o botão de reset
let posicaoScrollLista = 0; // Armazena a posição do scroll da sidebar

// Variáveis para o mapa
let map;
let municipiosGeoJsonLayer;
let ecoSystemsGeoJsonLayer;
let camadaAtiva = 'municipios'; // 'municipios' ou 'sistemas'

// Mapeamento de usos para ícones
const mapaIconesUsos = {
    'alimentícia': 'icon_alimenticia.png',
    'artesanal': 'icon_artesanal.png',
    'forrageira': 'icon_forrageira.png',
    'madeireira': 'icon_madeireira.png',
    'medicinal': 'icon_medicinal.png',
    'ornamental': 'icon_ornamental.png'
};

// Constantes para os ícones dinâmicos do botão de busca/retorno
const iconeBusca = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>`;
const iconeReset = `<svg viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path></svg>`;

/**
 * Atualiza o ícone e o título do botão principal dependendo se há texto no campo de busca
 */
function atualizarIconeBotao() {
    const textoAtual = campoBusca.value.trim();
    const temFiltros = document.querySelectorAll('.filter-options input:checked').length > 0;
    const emDetalhe = especieEmDetalhe !== null;
    const buscaAtiva = textoAtual !== "" && textoAtual === ultimaBuscaTexto;

    // O botão vira "Reset" se uma busca foi realizada, se há filtros ativos ou se estamos vendo detalhes
    if (buscaAtiva || temFiltros || emDetalhe || (textoAtual === "" && (temFiltros || emDetalhe))) {
        btnBuscar.innerHTML = iconeReset;
        btnBuscar.title = "Limpar Filtros e Voltar";
    } else {
        btnBuscar.innerHTML = iconeBusca;
        btnBuscar.title = "Realizar Pesquisa";
    }
}

// Função auxiliar para formatar nomes científicos seguindo as regras botânicas
function formatarNomeCientifico(nome) {
    if (!nome) return "";
    
    // Regex para identificar:
    // 1. Gênero (Primeira palavra capitalizada)
    // 2. Espécie (Segunda palavra)
    // 3. Opcional: subsp. ou var. seguido pelo epíteto infraespecífico
    // 4. O resto é considerado Autoridade
    const regex = /^([A-Z][a-z-]+)\s([a-z-]+)(?:\s(subsp\.|var\.)\s([a-z-]+))?(.*)$/;
    const match = nome.match(regex);

    if (!match) return `<i>${nome}</i>`; // Fallback caso o padrão fuja do comum

    const [_, genero, especie, conectivo, infraEpiteto, autoridade] = match;

    let resultado = `<i>${genero} ${especie}</i>`;
    if (conectivo && infraEpiteto) {
        resultado += ` ${conectivo} <i>${infraEpiteto}</i>`;
    }
    return resultado + (autoridade || "");
}

// Função para carregar os dados uma única vez
async function carregarDados() {
    try {
        let resposta = await fetch("data.json");
        if (!resposta.ok) {
            throw new Error(`HTTP error! status: ${resposta.status}`);
        }
        let dadosBrutos = await resposta.json();

        // Sanitização e conversão de dados (ajusta strings para arrays e corrige caminhos)
        dados = dadosBrutos.map(item => {
            return {
                ...item,
                nomesPopulares: typeof item.nomesPopulares === 'string' ? item.nomesPopulares.split(',').map(s => s.trim()) : (item.nomesPopulares || []),
                municipios: typeof item.municipios === 'string' ? item.municipios.split(',').map(s => s.trim()) : (item.municipios || []),
                sistemasEcologicos: typeof item.sistemasEcologicos === 'string' ? item.sistemasEcologicos.split(',').map(s => s.trim()) : (item.sistemasEcologicos || []),
                formaDeVida: typeof item.formaDeVida === 'string' ? item.formaDeVida.split(',').map(s => s.trim()) : (item.formaDeVida || []),
                bibliografia: typeof item.bibliografia === 'string' ? item.bibliografia.split('\n').map(s => s.trim()) : (Array.isArray(item.bibliografia) ? item.bibliografia : []),
                descricao: item.descricao || item.descricão || "Descrição detalhada em breve.",
                imagem: (item.imagem && !item.imagem.includes('/')) ? `img/${item.imagem}.png` : item.imagem
            };
        });

        // Tenta carregar o mapeamento de sobreposição geográfica
        let resMap = await fetch("municipios_sistemas.json");
        if (resMap.ok) {
            mapaGeograficoSistemas = await resMap.json();
        }

        // Ordena os dados: primeiro por família, depois por nome científico
        dados.sort((a, b) => {
            const familiaCompare = a.familia.localeCompare(b.familia);
            if (familiaCompare !== 0) return familiaCompare;
            return a.nomeCientifico.localeCompare(b.nomeCientifico);
        });
    } catch (error) {
        console.error("Erro ao carregar data.json:", error);
        cardContainer.innerHTML = "<p>Erro ao carregar dados das espécies. Por favor, tente novamente mais tarde.</p>";
    }
}
// Função que realiza a busca
function realizarBusca(permitirZoom = true) {
    especieEmDetalhe = null; // Sempre volta para a lista geral ao realizar uma nova busca ou aplicar filtro
    ultimaBuscaTexto = campoBusca.value.trim();
    if (dados.length > 0) {
        const termoBusca = campoBusca.value.toLowerCase();

        // Obtém os valores dos filtros selecionados
        const filtrosUso = Array.from(document.querySelectorAll('input[name="uso"]:checked')).map(cb => cb.value);
        const filtrosFormaDeVida = Array.from(document.querySelectorAll('input[name="formaDeVida"]:checked')).map(cb => cb.value);
        const filtrosAmeaca = Array.from(document.querySelectorAll('input[name="grauAmeaca"]:checked')).map(cb => cb.value);

        const dadosFiltrados = dados.filter(dado => {
            // 1. Busca por termo de texto
            const matchesText = termoBusca === "" || 
                dado.nome.toLowerCase().includes(termoBusca) ||
                (dado.nomesPopulares && dado.nomesPopulares.some(n => n.toLowerCase().includes(termoBusca))) ||
                dado.nomeCientifico.toLowerCase().includes(termoBusca) ||
                dado.familia.toLowerCase().includes(termoBusca) ||
                dado.uso.toLowerCase().includes(termoBusca) ||
                (dado.bioma && dado.bioma.toLowerCase().includes(termoBusca)) ||
                (dado.municipios && dado.municipios.some(m => m.toLowerCase().includes(termoBusca))) ||
                (dado.formaDeVida && dado.formaDeVida.some(f => f.toLowerCase().includes(termoBusca))) ||
                (dado.sistemasEcologicos && dado.sistemasEcologicos.some(s => s.toLowerCase().includes(termoBusca)));

            // 2. Filtro por Uso (se houver filtros selecionados)
            const matchesUso = filtrosUso.length === 0 || filtrosUso.some(u => {
                const usoNormalizado = dado.uso.toLowerCase();
                // Trata ornamental e paisagística como o mesmo uso
                if (u === 'ornamental' && (usoNormalizado.includes('ornamental') || usoNormalizado.includes('paisagística'))) return true;
                return usoNormalizado.includes(u);
            });

            // 3. Filtro por Forma de Vida
            const matchesFormaDeVida = filtrosFormaDeVida.length === 0 || (dado.formaDeVida && filtrosFormaDeVida.some(f => {
                return dado.formaDeVida.some(fv => fv.toLowerCase().includes(f));
            }));

            // 4. Filtro por Grau de Ameaça
            const matchesAmeaca = filtrosAmeaca.length === 0 || filtrosAmeaca.includes(dado.grauAmeaca);

            // A espécie deve passar em todos os critérios
            return matchesText && matchesUso && matchesFormaDeVida && matchesAmeaca;
        });

        const resultCountEl = document.getElementById("result-count");
        if (resultCountEl) {
            resultCountEl.textContent = `${dadosFiltrados.length} espécies encontradas`;
        }

        renderizarCards(dadosFiltrados, termoBusca);
        atualizarDestaquesNoMapa(dadosFiltrados, termoBusca, permitirZoom); // Atualiza o mapa com os resultados da busca
    }
}

function renderizarCards(dadosFiltrados, termoBusca = "") {
        cardContainer.innerHTML = ""; // Limpa os cards existentes antes de renderizar os novos
        const fragment = document.createDocumentFragment();

        const termoLower = termoBusca.toLowerCase().trim();
        let nomeCidadeOficial = "";
        let nomeSistemaOficial = "";

        // Verifica se o termo buscado é um município (validando no GeoJSON carregado)
        if (municipiosGeoJsonLayer && termoLower !== "") {
            municipiosGeoJsonLayer.eachLayer(layer => {
                if (layer.feature.properties.NM_MUN.toLowerCase() === termoLower) {
                    nomeCidadeOficial = layer.feature.properties.NM_MUN;
                }
            });
        }

        // Verifica se o termo buscado é um sistema ecológico
        if (ecoSystemsGeoJsonLayer && termoLower !== "" && !nomeCidadeOficial) {
            ecoSystemsGeoJsonLayer.eachLayer(layer => {
                if (layer.feature.properties.SECOL_POR.toLowerCase() === termoLower) {
                    nomeSistemaOficial = layer.feature.properties.SECOL_POR;
                }
            });
        }

        // Se for uma cidade, renderiza o cabeçalho especial
        if (nomeCidadeOficial) {
            // Estatísticas de espécies por família para a cidade selecionada
            const totalEspecies = dadosFiltrados.length;
            const familiasContagem = {};
            dadosFiltrados.forEach(d => {
                familiasContagem[d.familia] = (familiasContagem[d.familia] || 0) + 1;
            });

            // Ordena famílias por quantidade (maiores primeiro) e pega as top 5
            const familiasOrdenadas = Object.entries(familiasContagem).sort((a, b) => b[1] - a[1]);
            const maxEspeciesNaBarra = familiasOrdenadas[0] ? familiasOrdenadas[0][1] : 0;

            // Gera o gráfico de barras horizontais
            let barrasHtml = "";
            if (totalEspecies > 0) {
                // Pega as 5 principais famílias para não poluir demais
                const topFamilias = familiasOrdenadas.slice(0, 5);
                barrasHtml = topFamilias.map(([nome, count]) => {
                    const largura = (count / maxEspeciesNaBarra) * 100;
                    return `
                        <div class="stats-bar-row">
                            <span class="stats-bar-label" data-fam="${nome}">${nome}</span>
                            <div class="stats-bar-wrapper">
                                <div class="stats-bar-fill" style="width: ${largura}%"></div>
                                <span class="stats-bar-count">${count}</span>
                            </div>
                        </div>`;
                }).join('');
            }

            // Agora os dados vêm do mapeamento geográfico real, não das espécies
            const rawSistemas = mapaGeograficoSistemas[nomeCidadeOficial] || [];
            // Garante que o valor seja um array, mesmo que no JSON esteja como uma string única
            const sistemasDaCidade = Array.isArray(rawSistemas) ? rawSistemas : [rawSistemas];
            const sistemasArray = [...sistemasDaCidade].sort();
            
            const sistemasHtml = sistemasArray.map(s => `<span class="clickable-system" data-nome="${s}">• ${s}</span>`).join("<br>");

            const headerDiv = document.createElement("div");
            headerDiv.classList.add("city-search-header");

            let headerContent = `<h2 class="city-title">${nomeCidadeOficial}</h2>`;
            headerContent += `<p class="city-count"><strong>${totalEspecies}</strong> espécies registradas</p>`;
            
            if (totalEspecies > 0) {
                headerContent += `
                    <div class="city-stats-container bar-mode">
                        <p class="stats-intro">Principais famílias botânicas nesta localidade:</p>
                        ${barrasHtml}
                        ${familiasOrdenadas.length > 5 ? `<p class="stats-others">...e outras ${familiasOrdenadas.length - 5} famílias.</p>` : ''}
                    </div>`;
            }

            headerContent += `<div class="city-systems"><strong>Sistemas ecológicos:</strong><br>${sistemasHtml || "<em>Informação de sistemas não disponível para esta localidade.</em>"}</div>`;

            if (dadosFiltrados.length === 0) {
                headerContent += `<p class="no-results-msg">Oh não! Parece que não há registros válidos para <strong>${nomeCidadeOficial}</strong>! Você pode ajudar a melhorar isso contribuindo com fotos e identificações no <a href="https://www.inaturalist.org" target="_blank">iNaturalist</a>. Que tal procurar por um dos sistemas ecológicos presentes em ${nomeCidadeOficial}?</p>`;
            }
            
            headerDiv.innerHTML = headerContent;
            fragment.appendChild(headerDiv);

            // Adiciona evento para filtrar por família ao clicar no gráfico
            headerDiv.querySelectorAll('.stats-bar-label').forEach(el => {
                el.addEventListener('click', () => {
                    campoBusca.value = el.dataset.fam;
                    realizarBusca();
                    atualizarIconeBotao();
                });
            });

            // Subtítulo fora da caixa branca
            if (dadosFiltrados.length > 0) {
                const subtitle = document.createElement("p");
                subtitle.classList.add("city-subtitle-outside");
                subtitle.textContent = `Plantas de uso popular com registros para ${nomeCidadeOficial}:`;
                fragment.appendChild(subtitle);
            }

            // Adiciona eventos aos sistemas ecológicos listados no texto
            headerDiv.querySelectorAll('.clickable-system').forEach(el => {
                el.addEventListener('click', () => {
                    const sistemaNome = el.dataset.nome;
                    
                    // Alterna automaticamente para a camada de sistemas no mapa
                    if (camadaAtiva !== 'sistemas') {
                        camadaAtiva = 'sistemas';
                        map.removeLayer(municipiosGeoJsonLayer);
                        ecoSystemsGeoJsonLayer.addTo(map);
                        // Sincroniza visualmente o radio button
                        const radioSistemas = document.querySelector('input[name="map-view"][value="sistemas"]');
                        if (radioSistemas) radioSistemas.checked = true;
                    }

                    campoBusca.value = sistemaNome;
                    realizarBusca();
                });
            });
        } 
        // Se for um sistema ecológico, renderiza o cabeçalho especial
        else if (nomeSistemaOficial) {
            // Estatísticas de espécies por família para o sistema selecionado
            const totalEspecies = dadosFiltrados.length;
            const familiasContagem = {};
            dadosFiltrados.forEach(d => {
                familiasContagem[d.familia] = (familiasContagem[d.familia] || 0) + 1;
            });

            // Ordena famílias por quantidade (maiores primeiro) e pega as top 5
            const familiasOrdenadas = Object.entries(familiasContagem).sort((a, b) => b[1] - a[1]);
            const maxEspeciesNaBarra = familiasOrdenadas[0] ? familiasOrdenadas[0][1] : 0;

            // Gera o gráfico de barras horizontais
            let barrasHtml = "";
            if (totalEspecies > 0) {
                const topFamilias = familiasOrdenadas.slice(0, 5);
                barrasHtml = topFamilias.map(([nome, count]) => {
                    const largura = (count / maxEspeciesNaBarra) * 100;
                    return `
                        <div class="stats-bar-row">
                            <span class="stats-bar-label" data-fam="${nome}">${nome}</span>
                            <div class="stats-bar-wrapper">
                                <div class="stats-bar-fill" style="width: ${largura}%"></div>
                                <span class="stats-bar-count">${count}</span>
                            </div>
                        </div>`;
                }).join('');
            }

            const headerDiv = document.createElement("div");
            headerDiv.classList.add("system-search-header");

            let headerContent = `<h2 class="city-title">${nomeSistemaOficial}</h2>`;
            headerContent += `<p class="city-count"><strong>${totalEspecies}</strong> espécies registradas</p>`;

            if (totalEspecies > 0) {
                headerContent += `
                    <div class="city-stats-container bar-mode">
                        <p class="stats-intro">Principais famílias botânicas neste sistema:</p>
                        ${barrasHtml}
                        ${familiasOrdenadas.length > 5 ? `<p class="stats-others">...e outras ${familiasOrdenadas.length - 5} famílias.</p>` : ''}
                    </div>`;
            }

            if (dadosFiltrados.length === 0) {
                headerContent += `<p class="no-results-msg">Não encontramos plantas registradas especificamente para este filtro de busca dentro do sistema <strong>${nomeSistemaOficial}</strong>.</p>`;
            }
            
            headerDiv.innerHTML = headerContent;
            fragment.appendChild(headerDiv);

            // Adiciona evento para filtrar por família ao clicar no gráfico do sistema
            headerDiv.querySelectorAll('.stats-bar-label').forEach(el => {
                el.addEventListener('click', () => {
                    campoBusca.value = el.dataset.fam;
                    realizarBusca();
                    atualizarIconeBotao();
                });
            });

            if (dadosFiltrados.length > 0) {
                const subtitle = document.createElement("p");
                subtitle.classList.add("system-subtitle-outside");
                subtitle.textContent = `Plantas de uso popular com registros para o sistema ${nomeSistemaOficial}:`;
                fragment.appendChild(subtitle);
            }
        }

        let ultimaFamilia = ""; // Variável para controlar a exibição do cabeçalho
        for (let dado of dadosFiltrados) {
            // Se a família deste item for diferente da anterior, cria um novo cabeçalho
            if (dado.familia !== ultimaFamilia) {
                let header = document.createElement("h3");
                header.classList.add("family-header");
                header.textContent = dado.familia;
                fragment.appendChild(header); // Adiciona o título da família antes dos cards
                ultimaFamilia = dado.familia;
            }

            const threatImg = (dado.grauAmeaca && dado.grauAmeaca !== 'NE') 
                ? `<img src="img/${dado.grauAmeaca}_img.png" alt="${dado.grauAmeaca}" class="threat-icon" title="Grau de ameaça: ${dado.grauAmeaca}">` 
                : '';

            // Lógica da barra de usos (6 segmentos)
            const usosEspecie = dado.uso.toLowerCase();
            const coresUsos = {
                alimenticia: '#ff5757',
                artesanal: '#ffde59',
                forrageira: '#7ed957',
                madeireira: '#ff914d',
                medicinal: '#38b6ff',
                ornamental: '#cb6ce6'
            };

            const barraUsosHtml = `
                <div class="use-bar">
                    <div class="use-segment" style="background-color: ${usosEspecie.includes('alimentícia') ? coresUsos.alimenticia : 'transparent'}"></div>
                    <div class="use-segment" style="background-color: ${usosEspecie.includes('artesanal') ? coresUsos.artesanal : 'transparent'}"></div>
                    <div class="use-segment" style="background-color: ${usosEspecie.includes('forrageira') ? coresUsos.forrageira : 'transparent'}"></div>
                    <div class="use-segment" style="background-color: ${usosEspecie.includes('madeireira') ? coresUsos.madeireira : 'transparent'}"></div>
                    <div class="use-segment" style="background-color: ${usosEspecie.includes('medicinal') ? coresUsos.medicinal : 'transparent'}"></div>
                    <div class="use-segment" style="background-color: ${(usosEspecie.includes('ornamental') || usosEspecie.includes('paisagística')) ? coresUsos.ornamental : 'transparent'}"></div>
                </div>
            `;

            let article = document.createElement("article");
            article.classList.add("card");
            article.innerHTML = `
                <img src="${dado.imagem}" alt="${dado.nome}" class="card-img" loading="lazy">
                ${barraUsosHtml}
                <h2>${dado.nome}</h2>
                <p class="cientifico-truncado" title="${dado.nomeCientifico}">
                    <span class="texto-cientifico">${formatarNomeCientifico(dado.nomeCientifico)}</span>${threatImg}
                </p>
            `;
            
            // Adiciona evento de clique para abrir os detalhes
            article.addEventListener("click", (e) => {
                // Evita abrir detalhes se o usuário clicar diretamente no link externo
                if (e.target.tagName !== 'A') {
                    mostrarDetalhes(dado);
                }
            });
            fragment.appendChild(article);
        }

        cardContainer.appendChild(fragment); // Insere todos os cards e cabeçalhos de uma vez só
}

function mostrarDetalhes(dado) {
    especieEmDetalhe = dado; // Marca que estamos vendo os detalhes desta espécie

    // Salva a posição atual do scroll e leva a sidebar para o topo para ver o detalhe
    const sidebar = document.querySelector(".sidebar");
    if (sidebar) {
        posicaoScrollLista = sidebar.scrollTop;
        sidebar.scrollTop = 0;
    }

    cardContainer.innerHTML = ""; // Limpa a lista

    const threatImg = (dado.grauAmeaca && dado.grauAmeaca !== 'NE') 
        ? `<img src="img/${dado.grauAmeaca}_img.png" alt="${dado.grauAmeaca}" class="threat-icon" title="Grau de ameaça: ${dado.grauAmeaca}">` 
        : '';

    // Gera a lista de usos com ícones redondos para o detalhe
    const usos = dado.uso.split(',').map(u => u.trim());
    const listaUsosHtml = usos.map(uso => {
        const arquivo = mapaIconesUsos[uso.toLowerCase()];
        return `
            <div class="use-detail-item">
                ${arquivo ? `<img src="img/${arquivo}" class="use-icon-round">` : ''}
                <span>${uso}</span>
            </div>
        `;
    }).join('');

    const detalhe = document.createElement("div");
    detalhe.classList.add("card-detalhe");
    detalhe.innerHTML = `
        <button id="btn-voltar">← Voltar para a lista</button>
        <img src="${dado.imagem}" alt="${dado.nome}" class="img-detalhe-focada">
        <p class="atribuicao-foto">Imagem: <a href="https://www.inaturalist.org" target="_blank">Autoria</a></p>
        <h2>${dado.nome}</h2>
        <p class="cientifico">
            ${formatarNomeCientifico(dado.nomeCientifico)} ${threatImg}
        </p>
        <p><strong>Família:</strong> ${dado.familia}</p>
        <div class="use-detail-section">
            <p><strong>Uso:</strong></p>
            <div class="use-detail-grid">
                ${listaUsosHtml}
            </div>
        </div>
        ${dado.bioma ? `<p><strong>Bioma:</strong> ${dado.bioma}</p>` : ''}
        ${dado.nomesPopulares ? `<p><strong>Nome popular:</strong> ${dado.nomesPopulares.join(", ")}</p>` : ''}
        <div class="descricao-box">
            <p><strong>Sobre a espécie:</strong></p>
            <p>${dado.descricao || "Descrição detalhada em breve para esta espécie."}</p>
        </div>
        <div class="saiba-mais-box">
            <p><strong>Saiba mais:</strong></p>
            <a href="${dado.link}" target="_blank">"${dado.nome}" no Flora e Funga do Brasil</a>
            ${dado.linkiNaturalist ? `<a href="${dado.linkiNaturalist}" target="_blank">"${dado.nome}" no iNaturalist</a>` : ''}
        </div>
        ${dado.bibliografia && dado.bibliografia.length > 0 ? `
        <div class="bibliografia-box">
            <p><strong>Bibliografia consultada:</strong></p>
            <p style="font-size: 0.75rem; color: #666; line-height: 1.2; text-align: justify;">${dado.bibliografia.join('<br>')}</p>
        </div>` : ''}
    `;

    cardContainer.appendChild(detalhe);

    document.getElementById("btn-voltar").addEventListener("click", () => {
        especieEmDetalhe = null; // Limpa o estado de detalhe
        
        // Restaura a lista com os filtros e busca que estavam ativos
        realizarBusca(false); 
        atualizarIconeBotao();

        // Restaura a posição do scroll
        const sidebar = document.querySelector(".sidebar");
        if (sidebar) {
            sidebar.scrollTop = posicaoScrollLista;
        }
    });

    atualizarDestaquesNoMapa([dado]); // Destaca apenas os municípios da espécie detalhada
}

// Paleta de 7 cores em tons naturais e agradáveis
const coresPaleta = [
    '#A8C69F', '#95B3D7', '#E4C1A1', '#B1A0C7', '#C4D79B', '#DA9694', '#8DB4B4', 
    '#F3E5AB', '#FFD700', '#FFB347', '#D2B48C', '#BC8F8F', '#F0E68C', '#E9967A',
    '#4682B4', '#228B22', '#008080', '#6A5ACD', '#483D8B', '#2F4F4F', '#556B2F'
];

const coresDestaquePaleta = [
    '#4E8B3E', '#2B5DAD', '#C27E40', '#7D4DB8', '#81A32D', '#B53F3D', '#3F7A7A',
    '#D4AF37', '#B8860B', '#E67E22', '#8B4513', '#A52A2A', '#BDB76B', '#CD5C5C',
    '#1B4F72', '#0B5345', '#0E6251', '#483D8B', '#191970', '#145A32', '#1B2631'
];

// Função para gerar uma cor consistente baseada no nome do local
// Paletas categorizadas
const indicesQuentes = [2, 3, 5, 7, 8, 9, 10, 11, 12, 13]; 
const indicesFrios = [0, 1, 4, 6, 14, 15, 16, 17, 18, 19, 20];

// Função para obter a cor base usando o índice pré-calculado
function obterCorBase(feature) {
    const index = feature.properties.colorIndex;
    if (index === undefined) return '#e9ecef';
    return coresPaleta[index];
}

// Função para gerar a cor de destaque usando o índice pré-calculado
function obterCorDestaque(feature) {
    const index = feature.properties.colorIndex;
    if (index === undefined) return '#285430';
    return coresDestaquePaleta[index];
}

// Estilos para os polígonos do mapa
function estiloPadrao(feature, propNome) {
    // Se houver uma espécie selecionada, o fundo fica cinza claro
    const corFundo = especieEmDetalhe ? '#e9ecef' : obterCorBase(feature);
    return {
        fillColor: corFundo,
        weight: 0.5, // Linhas bem finas para evitar o aspecto "chunky"
        opacity: 1,
        color: 'rgba(255,255,255,0.6)', // Branco semi-transparente para suavizar
        fillOpacity: especieEmDetalhe ? 0.3 : 0.5 // Mais transparente quando em detalhe
    };
}

function estiloDestaque(feature, propNome) {
    // Se houver uma espécie selecionada, destaca com o verde tema do site (#285430)
    const corDestaque = especieEmDetalhe ? '#285430' : obterCorDestaque(feature);
    return {
        fillColor: corDestaque,
        weight: 1.5,
        opacity: 1,
        color: 'white',
        fillOpacity: 0.9
    };
}

// Função para inicializar o mapa
async function inicializarMapa() {
    try {
        const mapContainer = document.getElementById('map-container');
        if (!mapContainer) {
            console.error("Elemento #map-container não encontrado no DOM. O mapa não pode ser inicializado.");
            // Opcionalmente, exiba uma mensagem de erro na área principal se map-container for crítico
            // cardContainer.innerHTML = "<p>Erro crítico: Contêiner do mapa não encontrado.</p>";
            return; // Interrompe a execução se o contêiner estiver faltando
        }
        console.log("map-container element found:", mapContainer);
        console.log("map-container dimensions (offsetWidth, offsetHeight):", mapContainer.offsetWidth, mapContainer.offsetHeight);
        if (mapContainer.offsetWidth === 0 || mapContainer.offsetHeight === 0) {
            console.warn("map-container tem largura ou altura zero. O mapa pode não renderizar corretamente. Verifique o CSS.");
        }

        // Define os limites do Rio Grande do Sul (aproximados) para restringir a navegação
        const rsBounds = L.latLngBounds(
            L.latLng(-33.8, -57.7), // Sudoeste
            L.latLng(-27.0, -49.6)  // Nordeste
        );

        map = L.map('map-container', {
            renderer: L.canvas(), // Muda de SVG para Canvas: MUITO mais rápido para 500+ polígonos
            minZoom: 6,
            maxBounds: rsBounds
        }).setView([-30.0346, -51.2177], 7);

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        }).addTo(map);

        // Carregar o GeoJSON dos municípios
        municipiosGeoJsonLayer = await criarCamadaGeoJson('RS_Municipios_2024.geojson', 'NM_MUN', 'municipios');
        municipiosGeoJsonLayer.addTo(map);

        // Carregar o GeoJSON dos sistemas ecológicos
        ecoSystemsGeoJsonLayer = await criarCamadaGeoJson('Ecological_systems_RS_Brazil_latlong.geojson', 'SECOL_POR', 'sistemas');

    } catch (error) {
        console.error("Erro ao inicializar o mapa ou carregar GeoJSON:", error);
    }
}

async function criarCamadaGeoJson(url, propriedadeNome, tipoMapa = 'municipios') {
    const resposta = await fetch(url);
    if (!resposta.ok) throw new Error(`Erro ao carregar ${url}`);
    const geoJsonData = await resposta.json();
    const nomesIgnorados = ['Área Operacional "Lagoa Mirim"', 'Área Operacional "Lagoa dos Patos"'];

    // Filtra os dados primeiro
    geoJsonData.features = geoJsonData.features.filter(f => !nomesIgnorados.includes(f.properties[propriedadeNome]));

    if (tipoMapa === 'sistemas') {
        // Lógica de "Uma cor por Nome" para Sistemas Ecológicos
        const mapeamentoCoresSistemas = {};
        let contadorQuente = 0;
        let contadorFrio = 0;

        geoJsonData.features.forEach((feature) => {
            const nome = feature.properties[propriedadeNome];
            if (mapeamentoCoresSistemas[nome] === undefined) {
                const nomeLower = nome.toLowerCase();
                // Campos = Cores Quentes, Matas/Florestas = Cores Frias
                if (nomeLower.includes('campo')) {
                    mapeamentoCoresSistemas[nome] = indicesQuentes[contadorQuente % indicesQuentes.length];
                    contadorQuente++;
                } else {
                    mapeamentoCoresSistemas[nome] = indicesFrios[contadorFrio % indicesFrios.length];
                    contadorFrio++;
                }
            }
            feature.properties.colorIndex = mapeamentoCoresSistemas[nome];
        });
    } else {
        // Mantém Algoritmo de Coloração Gulosa para Municípios (Vizinhos diferentes)
        const coordMap = {}; 
        
        // 1. Mapeia adjacência por coordenadas
        geoJsonData.features.forEach((feature, idx) => {
            const coords = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates.flat(1)[0];
            coords.forEach(c => {
                const key = `${c[0].toFixed(4)},${c[1].toFixed(4)}`;
                if (!coordMap[key]) coordMap[key] = [];
                coordMap[key].push(idx);
            });
        });

        // 2. Atribui cores evitando vizinhos iguais
        geoJsonData.features.forEach((feature, idx) => {
            const vizinhosIndices = new Set();
            const coords = feature.geometry.type === 'Polygon' ? feature.geometry.coordinates[0] : feature.geometry.coordinates.flat(1)[0];
            
            coords.forEach(c => {
                const key = `${c[0].toFixed(4)},${c[1].toFixed(4)}`;
                coordMap[key].forEach(vIdx => { if(vIdx !== idx) vizinhosIndices.add(vIdx); });
            });

            const coresVizinhos = Array.from(vizinhosIndices)
                .map(vIdx => geoJsonData.features[vIdx].properties.colorIndex)
                .filter(c => c !== undefined);

            const paletaDisponivel = Array.from({length: coresPaleta.length}, (_, i) => i);
            let corEscolhida = paletaDisponivel.find(c => !coresVizinhos.includes(c));
            if (corEscolhida === undefined) corEscolhida = paletaDisponivel[0];
            
            feature.properties.colorIndex = corEscolhida;
        });
    }

    return L.geoJSON(geoJsonData, {
        style: (feature) => estiloPadrao(feature, propriedadeNome),
        onEachFeature: function (feature, layer) {
            const nome = feature.properties[propriedadeNome];

            layer.on({
                mouseover: (e) => {
                    e.target.setStyle({ weight: 2, color: '#333', fillOpacity: 0.8 });
                    if (mapHud) {
                        mapHud.textContent = nome;
                        mapHud.style.borderLeftColor = obterCorDestaque(feature);
                        mapHud.classList.add("visible");
                    }
                },
                click: (e) => {
                    campoBusca.value = nome;
                    realizarBusca();
                },
                mouseout: (e) => {
                    e.target.setStyle(elementosDestaque.has(nome) ? estiloDestaque(e.target.feature, propriedadeNome) : estiloPadrao(e.target.feature, propriedadeNome));
                    if (mapHud) mapHud.classList.remove("visible");
                }
            });
        }
    });
}

let elementosDestaque = new Set(); 

// Função para atualizar os destaques no mapa com base nas espécies filtradas
function atualizarDestaquesNoMapa(especiesFiltradas, termoBusca = "", permitirZoom = true) {
    elementosDestaque.clear();
    const termo = termoBusca.toLowerCase().trim();
    
    const layerAtual = camadaAtiva === 'municipios' ? municipiosGeoJsonLayer : ecoSystemsGeoJsonLayer;
    const propNome = camadaAtiva === 'municipios' ? 'NM_MUN' : 'SECOL_POR';
    const campoGeografico = camadaAtiva === 'municipios' ? 'municipios' : 'sistemasEcologicos';

    // 1. Identifica se o termo de busca coincide com um local geográfico oficial
    let localPesquisadoOficial = "";
    if (termo !== "" && layerAtual) {
        layerAtual.eachLayer(l => {
            const nomeNoMapa = l.feature.properties[propNome];
            if (nomeNoMapa.toLowerCase() === termo) {
                localPesquisadoOficial = nomeNoMapa;
                elementosDestaque.add(nomeNoMapa); // Destaca o local mesmo sem espécies
            }
        });
    }

    // 2. Adiciona os locais das espécies encontradas
    especiesFiltradas.forEach(especie => {
        if (especie[campoGeografico]) {
            especie[campoGeografico].forEach(item => {
                // Se a busca foi por um local específico, mantemos o foco apenas nele
                if (localPesquisadoOficial !== "") {
                    if (item.toLowerCase() === termo) elementosDestaque.add(item);
                } else {
                    // Se foi busca por nome/uso, destacamos todos os locais da planta
                    elementosDestaque.add(item);
                }
            });
        }
    });

    if (layerAtual) {
        layerAtual.eachLayer(layer => {
            const nome = layer.feature.properties[propNome];
            layer.setStyle(elementosDestaque.has(nome) ? estiloDestaque(layer.feature, propNome) : estiloPadrao(layer.feature, propNome));
        });
        if (permitirZoom) {
            ajustarZoomMapa(layerAtual, propNome);
        }
    }
}

function ajustarZoomMapa(layer, propNome) {
    const camadasDestacadas = [];
    layer.eachLayer(l => {
        if (elementosDestaque.has(l.feature.properties[propNome])) camadasDestacadas.push(l);
    });

    map.invalidateSize(); // Garante que o Leaflet conhece o tamanho atual do container

    if (camadasDestacadas.length > 0) {
        // Usa flyToBounds para um movimento de câmera mais fluido
        map.flyToBounds(L.featureGroup(camadasDestacadas).getBounds(), {
            padding: [40, 40],
            maxZoom: 12, // Impede que o zoom entre demais em municípios pequenos
            animate: true,
            duration: 1.5 // Movimento um pouco mais lento e elegante
        });
    } else {
        map.flyTo([-30.0346, -51.2177], 7, { duration: 1.5 });
    }
}

function alternarCamada(event) {
    camadaAtiva = event.target.value;
    if (camadaAtiva === 'municipios') {
        map.removeLayer(ecoSystemsGeoJsonLayer);
        municipiosGeoJsonLayer.addTo(map);
    } else {
        map.removeLayer(municipiosGeoJsonLayer);
        ecoSystemsGeoJsonLayer.addTo(map);
    }

    // Se um card detalhado estiver aberto, atualiza o mapa apenas para ele
    if (especieEmDetalhe) {
        atualizarDestaquesNoMapa([especieEmDetalhe], "", false);
    } else {
        // Caso contrário, executa a busca normal
        realizarBusca(false); 
    }
}

// Função principal para iniciar a aplicação
async function iniciarApp() {
    console.log("iniciarApp() started."); // Adicionado para depuração
    await carregarDados(); // Espera os dados serem carregados
    await inicializarMapa(); // Inicializa o mapa após carregar os dados

    // Atualiza o ícone inicialmente
    atualizarIconeBotao();

    // Monitora a digitação para mudar o ícone em tempo real
    campoBusca.addEventListener("input", atualizarIconeBotao);

    btnBuscar.addEventListener("click", () => {
        const textoAtual = campoBusca.value.trim();
        const buscaJaRealizada = textoAtual !== "" && textoAtual === ultimaBuscaTexto;

        if (textoAtual !== "" && !buscaJaRealizada) {
            // Se tem texto novo e ainda não buscou, realiza a busca
            realizarBusca();
        } else {
            // Caso contrário (campo vazio ou clicou em reset), limpa TUDO
            campoBusca.value = "";
            ultimaBuscaTexto = "";
            document.querySelectorAll('.filter-options input').forEach(cb => cb.checked = false);
            especieEmDetalhe = null;
            realizarBusca();
        }
        atualizarIconeBotao();
    });

    campoBusca.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
            realizarBusca();
            atualizarIconeBotao();
        }
    });
    
    document.querySelectorAll('input[name="map-view"]').forEach(radio => {
        radio.addEventListener('change', alternarCamada);
    });

    // Lógica para o painel de filtros
    const toggleFiltersBtn = document.getElementById('toggle-filters');
    const filtersContent = document.getElementById('filters-content');
    toggleFiltersBtn.addEventListener('click', () => {
        const isHidden = filtersContent.classList.toggle('hidden');
        toggleFiltersBtn.classList.toggle('active', !isHidden);
    });

    // Aciona a busca automaticamente ao marcar/desmarcar um filtro
    document.querySelectorAll('.filter-options input').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            realizarBusca();
            atualizarIconeBotao();
        });
    });

    // Lógica para o painel de informações (Sobre, Usos, etc)
    const infoOverlay = document.getElementById('info-overlay');
    const infoBtns = document.querySelectorAll('.info-btn');
    const closeInfo = document.getElementById('close-info');
    const sections = document.querySelectorAll('.info-section');

    infoBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const sectionId = btn.getAttribute('data-section');
            
            // Se já estiver aberto na mesma seção, fecha
            if (infoOverlay.classList.contains('open') && btn.classList.contains('active')) {
                infoOverlay.classList.remove('open');
                btn.classList.remove('active');
                return;
            }

            infoBtns.forEach(b => b.classList.remove('active'));
            sections.forEach(s => s.classList.remove('active'));
            
            btn.classList.add('active');
            document.getElementById(`content-${sectionId}`).classList.add('active');
            infoOverlay.classList.add('open');
        });
    });

    closeInfo.addEventListener('click', () => {
        infoOverlay.classList.remove('open');
        infoBtns.forEach(b => b.classList.remove('active'));
    });

    renderizarCards(dados); // Mostra os cards iniciais
    atualizarDestaquesNoMapa(dados); // Atualiza o mapa com todos os municípios das espécies iniciais
    console.log("iniciarApp() finished."); // Adicionado para depuração
}

iniciarApp(); // Inicia a aplicação