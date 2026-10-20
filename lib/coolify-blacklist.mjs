// Hard blacklist for the restricted Coolify terminal. Nothing on these lists may ever run, even if an
// administrator puts it on the allowlist: the allowlist is checked first for membership, this list
// is checked for every command (when it is defined and again before every run) and every argument.

// Executables that must never be the command, grouped by the harm they allow.
const GROUPS = {
  shellsAndInterpreters: [
    'sh',
    'bash',
    'zsh',
    'dash',
    'ash',
    'ksh',
    'csh',
    'tcsh',
    'fish',
    'busybox',
    'python',
    'perl',
    'ruby',
    'node',
    'nodejs',
    'deno',
    'bun',
    'lua',
    'tclsh',
    'awk',
    'gawk',
    'mawk',
    'sed',
    'ed',
    'ex',
    'vi',
    'vim',
    'nano',
    'less',
    'more',
    'man'
  ],
  commandWrappers: [
    'env',
    'eval',
    'exec',
    'xargs',
    'nice',
    'nohup',
    'timeout',
    'time',
    'command',
    'builtin',
    'stdbuf',
    'setsid',
    'watch',
    'find',
    'source',
    'flock',
    'script',
    'screen',
    'tmux',
    'expect',
    'strace',
    'gdb',
    'git',
    'make',
    'cmake',
    'gcc',
    'cc',
    'go',
    'cargo',
    'java'
  ],
  privilege: ['su', 'sudo', 'doas', 'chroot', 'unshare', 'nsenter', 'setcap'],
  destroyOrChangeFiles: [
    'rm',
    'rmdir',
    'unlink',
    'shred',
    'dd',
    'fdisk',
    'sfdisk',
    'parted',
    'wipefs',
    'truncate',
    'mv',
    'cp',
    'ln',
    'chmod',
    'chown',
    'chgrp',
    'chattr',
    'tee',
    'install',
    'tar',
    'unzip',
    'zip',
    'mkswap',
    'swapoff'
  ],
  readFilesAndSecrets: [
    'cat',
    'tac',
    'head',
    'tail',
    'strings',
    'xxd',
    'od',
    'hexdump',
    'base64',
    'grep',
    'egrep',
    'fgrep',
    'rg',
    'ag',
    'printenv',
    'export',
    'set',
    'history'
  ],
  network: [
    'curl',
    'wget',
    'nc',
    'ncat',
    'netcat',
    'telnet',
    'ssh',
    'scp',
    'sftp',
    'ftp',
    'tftp',
    'rsync',
    'socat',
    'nmap'
  ],
  systemAndProcesses: [
    'kill',
    'killall',
    'pkill',
    'reboot',
    'shutdown',
    'halt',
    'poweroff',
    'init',
    'telinit',
    'systemctl',
    'service',
    'mount',
    'umount',
    'iptables',
    'nft',
    'ip',
    'ifconfig',
    'crontab',
    'at',
    'batch',
    'passwd',
    'useradd',
    'userdel',
    'usermod',
    'groupadd'
  ],
  containersAndPackages: [
    'docker',
    'docker-compose',
    'podman',
    'kubectl',
    'crictl',
    'nerdctl',
    'apt',
    'apt-get',
    'dpkg',
    'apk',
    'yum',
    'dnf',
    'pip',
    'pip3',
    'npm',
    'npx',
    'yarn',
    'pnpm',
    'gem',
    'composer'
  ],
  databaseClients: ['mysql', 'mysqladmin', 'mysqldump', 'psql', 'pg_dump', 'redis-cli', 'mongo', 'mongosh', 'sqlite3']
};

export const BLOCKED_EXECUTABLES = new Set(Object.values(GROUPS).flat());
// Families of executables that are matched by pattern (mkfs.ext4, python3.12, perl5 ...).
export const BLOCKED_EXECUTABLE_PATTERNS = [/^mkfs(\..+)?$/, /^python[0-9.]*$/, /^perl[0-9.]*$/, /^pip[0-9.]+$/];

// Subcommands and flags that must never appear anywhere in a command or its arguments.
export const BLOCKED_TOKENS = new Set([
  // Arbitrary code execution
  'tinker',
  '-r',
  '-e',
  '-c',
  '-a',
  '-d',
  '--eval',
  '--run',
  '--exec',
  '--define',
  '--interactive',
  // Laravel/artisan commands that wipe data, invalidate secrets or take the app offline
  'db:wipe',
  'migrate:fresh',
  'migrate:reset',
  'migrate:refresh',
  'migrate:rollback',
  'db:seed',
  'key:generate',
  'down',
  // Destructive database words
  'flushall',
  'flushdb'
]);
// Paths and files that hold secrets or control the host.
export const BLOCKED_TOKEN_PATTERNS = [
  /^\/(etc|proc|sys|dev|root|boot|run|var\/run)(\/|$)/i,
  /docker\.sock/i,
  /(^|\/)\.env(\..+)?$/i,
  /(^|\/)(id_rsa|id_ed25519|authorized_keys|known_hosts|shadow|passwd)$/i
];

const lower = value => String(value).toLowerCase();
const basename = value => lower(value).split('/').filter(Boolean).at(-1) || '';

export function isBlockedExecutable(token) {
  const names = [lower(token), basename(token)];
  return names.some(name => BLOCKED_EXECUTABLES.has(name) || BLOCKED_EXECUTABLE_PATTERNS.some(re => re.test(name)));
}

// A token is checked as written, by its last path segment and by the value of `--flag=value`.
export function isBlockedToken(token) {
  const text = String(token);
  const value = text.includes('=') ? text.slice(text.indexOf('=') + 1) : '';
  const names = [lower(text), basename(text), lower(value), basename(value)].filter(Boolean);
  return (
    names.some(name => BLOCKED_TOKENS.has(name)) ||
    [text, value].filter(Boolean).some(part => BLOCKED_TOKEN_PATTERNS.some(re => re.test(part)))
  );
}
