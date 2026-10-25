// Monta o "vídeo bruto" de teste: uma imagem parada com a fala gerada pela voz
// do Windows (teste/video-de-teste/gerar-fala.ps1), exportado em MP4 vertical
// como se tivesse vindo do celular. Tudo no FilmCraft: edição pelo MCP,
// renderização pelo CLI.
//
//   node scripts/montar-bruto-de-teste.ts <pasta com quadro.png e fala.wav>
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { acharCli } from '../src/config.ts';
import { abrirMcp } from '../src/mcp-cru.ts';

const pasta = path.resolve(process.argv[2]);
const mcp = await abrirMcp({ type: 'stdio', command: acharCli('filmcraft'), args: ['mcp', '--data-dir', path.join(pasta, '.filmcraft')] });
const passo = async (nome: string, args: Record<string, unknown> = {}) => {
  const r = await mcp.chamar(nome, args);
  if (r.erro) throw new Error(`${nome}: ${r.texto}`);
  return r.texto ? JSON.parse(r.texto) : null;
};
try {
  const { items: [quadro, fala] } = await passo('media_import', { paths: [path.join(pasta, 'quadro.png'), path.join(pasta, 'fala.wav')] });
  const proj = await passo('project_inspect');
  const duracao = proj.root.children.find((c: { item: number }) => c.item === fala).duration as number;
  await passo('command_run', { id: 'file.newSequence', params: { name: 'bruto', width: 1080, height: 1920, fps: 30, video: 1, audio: 1 } });
  await passo('command_run', { id: 'timeline.place', params: { item: fala, track: 'A1', seconds: 0 } });
  await passo('command_run', { id: 'timeline.place', params: { item: quadro, track: 'V1', seconds: 0, duration: duracao } });
  await passo('command_run', { id: 'file.saveAs', params: { path: path.join(pasta, 'bruto.fcproj') } });
} finally {
  mcp.fechar();
}
// A exportação pelo MCP vira um job que não anda enquanto o servidor espera o
// próximo pedido; o "export" do CLI renderiza e só volta com o arquivo pronto.
execFileSync(acharCli('filmcraft'), ['--project', path.join(pasta, 'bruto.fcproj'), 'export', path.join(pasta, 'bruto.mp4'), '--preset', 'Social Vertical 1080×1920'], { stdio: 'ignore' });
console.log(`bruto: ${path.join(pasta, 'bruto.mp4')}`);
