# Установка на Debian, Ubuntu, Linux Mint, Pop!_OS

Поддерживаются Debian 12+, Ubuntu 22.04+, Linux Mint 21+, Pop!_OS 22.04+ (amd64).

1. Скачайте `kot-kod_<версия>_amd64.deb` и `SHA256SUMS.txt` со страницы [Releases](https://github.com/Serge-Nook/kot-kod/releases).
2. Проверьте контрольную сумму:
   ```bash
   sha256sum -c SHA256SUMS.txt --ignore-missing
   ```
3. Установите пакет вместе с зависимостями (Git, libsecret и др.):
   ```bash
   sudo apt install ./kot-kod_*_amd64.deb
   ```
4. Запустите «Кот-код» из меню приложений (раздел «Разработка») или командой `kot-kod`.

## Обновление

Скачайте новый `.deb` и выполните ту же команду `sudo apt install ./kot-kod_*_amd64.deb`. Приложение сообщает о новых версиях при запуске.

## Удаление

```bash
sudo apt remove kot-kod
```

Настройки пользователя (`~/.config/kot-kod`) и журналы (`~/.local/state/kot-kod`) при этом сохраняются.

## AppImage

На любом дистрибутиве также можно использовать AppImage — см. [install-steamdeck.md](install-steamdeck.md).
