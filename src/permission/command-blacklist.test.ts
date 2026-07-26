import assert from 'node:assert/strict';
import test from 'node:test';
import { matchDangerousCommand } from './command-blacklist.js';

const dangerous = [
  ['rm -rf /', 'system_root_deletion'],
  ['sudo rm -r -f /*', 'system_root_deletion'],
  ['sudo -n /bin/rm -rf /', 'system_root_deletion'],
  ['echo ok && sudo mkfs.ext4 /dev/sda1', 'filesystem_format'],
  ['newfs_apfs /dev/disk9', 'filesystem_format'],
  ['dd if=/dev/zero of=/dev/disk9 bs=1m', 'raw_device_write'],
  ['echo ok; sudo reboot', 'system_shutdown'],
  ['/usr/sbin/shutdown -h now', 'system_shutdown'],
  [':(){ :|:& };:', 'fork_bomb'],
] as const;

test('dangerous command patterns cover mandatory categories', () => {
  for (const [command, category] of dangerous) {
    assert.equal(matchDangerousCommand(command)?.category, category, command);
  }
});

test('dangerous command patterns do not block ordinary project commands', () => {
  const safe = [
    'pnpm test',
    'git status',
    'rm -rf ./dist',
    'echo "rm -rf /"',
    'echo "safe; reboot"',
    "printf 'safe | /sbin/reboot'",
    'printf "reboot"',
    'node -e "console.log(\'mkfs\')"',
    'cat docs/shutdown-notes.md',
  ];
  for (const command of safe) {
    assert.equal(matchDangerousCommand(command), undefined, command);
  }
});
