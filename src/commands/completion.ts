import { ExitCode } from "../util/exit.ts";

/**
 * Print a shell completion script. Minimal but real: completes the subcommands,
 * formats, and the most-used flags. ponytail: static scripts, no dynamic discovery.
 */
const SUBCOMMANDS = "run diff locks studio completion";
const FLAGS =
  "--format --output --tldr --redact --ascii --color --no-color --fail-on --strict --config --statement --quiet --verbose --debug --help --version";
const FORMATS = "terminal markdown json html text";

const BASH = `# pg-explain bash completion
_pg_explain() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"
  if [ "$prev" = "--format" ] || [ "$prev" = "-f" ]; then
    COMPREPLY=( $(compgen -W "${FORMATS}" -- "$cur") ); return
  fi
  if [ "$COMP_CWORD" -eq 1 ]; then
    COMPREPLY=( $(compgen -W "${SUBCOMMANDS} ${FLAGS}" -f -- "$cur") ); return
  fi
  COMPREPLY=( $(compgen -W "${FLAGS}" -f -- "$cur") )
}
complete -F _pg_explain pg-explain
`;

const ZSH = `#compdef pg-explain
# pg-explain zsh completion
_pg_explain() {
  local -a subcmds flags
  subcmds=(${SUBCOMMANDS.split(" ")
    .map((s) => `'${s}'`)
    .join(" ")})
  flags=(${FLAGS.split(" ")
    .map((f) => `'${f}'`)
    .join(" ")})
  if (( CURRENT == 2 )); then
    _alternative "subcmds:subcommand:(\${subcmds})" 'files:file:_files' "flags:flag:(\${flags})"
  else
    _alternative 'files:file:_files' "flags:flag:(\${flags})"
  fi
}
compdef _pg_explain pg-explain
`;

const FISH = `# pg-explain fish completion
complete -c pg-explain -f
${SUBCOMMANDS.split(" ")
  .map((s) => `complete -c pg-explain -n '__fish_use_subcommand' -a '${s}'`)
  .join("\n")}
complete -c pg-explain -l format -x -a '${FORMATS}'
${FLAGS.split(" ")
  .filter((f) => f.startsWith("--"))
  .map((f) => `complete -c pg-explain -l '${f.replace(/^--/, "")}'`)
  .join("\n")}
`;

export function runCompletion(shell: string | undefined): ExitCode {
  const scripts: Record<string, string> = { bash: BASH, zsh: ZSH, fish: FISH };
  const script = shell ? scripts[shell] : undefined;
  if (!script) {
    process.stderr.write(
      `Usage: pg-explain completion <bash|zsh|fish>\n` +
        `  bash: pg-explain completion bash > /etc/bash_completion.d/pg-explain\n` +
        `  zsh:  pg-explain completion zsh  > "\${fpath[1]}/_pg-explain"\n` +
        `  fish: pg-explain completion fish > ~/.config/fish/completions/pg-explain.fish\n`,
    );
    return ExitCode.Usage;
  }
  process.stdout.write(script);
  return ExitCode.Success;
}
