# BUVA on the Oracle free micro VM

Moves the live shop (orders, customers, deals, uploaded photos) from WSL to the Oracle VM
"webserver" (1 GB RAM). The VM pulls the ready-made images from GHCR; nothing is built there.
The shop is paused for about 10 minutes during the move.

## 1. On the VM (Oracle web console)
    free -m; df -h /
    sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
    curl -fsSL https://tailscale.com/install.sh | sh
    sudo tailscale up --ssh --hostname=webserver
Open the link it prints and sign in with the SAME Tailscale account as WSL.
From now on you can reach the VM from WSL with no key:  ssh ubuntu@webserver

## 2. In WSL, from your BUVA folder
    bash deploy/oracle-micro/wsl-export.sh

## 3. On the VM (ssh ubuntu@webserver from WSL, or the web console)
    mkdir -p ~/buva && sudo tailscale file get ~/ && tar xzf ~/buva-move.tgz -C ~/buva --strip-components=1 && rm ~/buva-move.tgz
    cd ~/buva && sudo bash vm-install.sh
It asks once for a GitHub token with only `read:packages` (github.com/settings/tokens, classic).

## 4. In Nginx Proxy Manager
Edit buva.shop (and www.buva.shop / bhuva.duckdns.org if added):
Forward Hostname `buva-web`, Port `80`, scheme http. Save, then open https://buva.shop.

## Going back
NPM: forward to 100.126.156.63 port 9090 again, then in WSL: `docker compose start api web`.

## Everyday
    cd ~/buva
    sudo docker compose pull && sudo docker compose up -d     # after a new push to GitHub
    sudo docker compose logs --tail 50 api
    free -m
Backups: ~/buva/backups (nightly). Copy one to your PC now and then:
    sudo tailscale file cp ~/buva/backups/<file> <your-pc-name>:
