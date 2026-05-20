#!/usr/bin/env bash
set -Eeuo pipefail
trap 'echo "ERROR: deploy failed at line $LINENO" >&2' ERR

APP_NAME="${APP_NAME:-codexnovel}"
SERVICE_NAME="${SERVICE_NAME:-$APP_NAME}"
PORT="${PORT:-3008}"
DB_NAME="${DB_NAME:-novel}"
DB_USER="${DB_USER:-novel_app}"
DB_CONNECTION_LIMIT="${DB_CONNECTION_LIMIT:-20}"
DB_QUEUE_LIMIT="${DB_QUEUE_LIMIT:-0}"
PUBLIC_CACHE_TTL_MS="${PUBLIC_CACHE_TTL_MS:-10000}"
PAGE_VIEW_BATCH_SIZE="${PAGE_VIEW_BATCH_SIZE:-100}"
PAGE_VIEW_FLUSH_INTERVAL_MS="${PAGE_VIEW_FLUSH_INTERVAL_MS:-1000}"
DOMAIN="${DOMAIN:-}"
ENABLE_SSL="${ENABLE_SSL:-0}"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" >/dev/null 2>&1 && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." >/dev/null 2>&1 && pwd)}"
ENV_FILE="$APP_DIR/.env"
LOG_FILE="${LOG_FILE:-$APP_DIR/deploy-ubuntu.log}"

mkdir -p "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

if [ "${EUID:-$(id -u)}" -eq 0 ]; then
  SUDO=""
  DEFAULT_USER="${SUDO_USER:-www-data}"
else
  SUDO="sudo"
  DEFAULT_USER="$(id -un)"
fi

APP_USER="${APP_USER:-$DEFAULT_USER}"
if [ "$APP_USER" = "root" ]; then
  APP_USER="www-data"
fi
APP_GROUP="${APP_GROUP:-}"

log() {
  printf '\n\033[1;32m%s\033[0m\n' "$*"
}

die() {
  printf '\n\033[1;31m%s\033[0m\n' "$*" >&2
  exit 1
}

random_token() {
  openssl rand -hex 32
}

env_value() {
  local key="$1"
  if [ -f "$ENV_FILE" ]; then
    grep -E "^${key}=" "$ENV_FILE" | tail -n 1 | cut -d= -f2- || true
  fi
}

sql_escape() {
  printf "%s" "$1" | sed "s/'/''/g"
}

shell_quote() {
  printf "'%s'" "$(printf "%s" "$1" | sed "s/'/'\\\\''/g")"
}

run_as_app_user() {
  local command="$1"

  if [ "$(id -un)" = "$APP_USER" ]; then
    bash -lc "$command"
  elif [ "$(id -u)" -eq 0 ]; then
    runuser -u "$APP_USER" -- bash -lc "$command"
  else
    sudo -u "$APP_USER" bash -lc "$command"
  fi
}

validate_identifier() {
  local name="$1"
  local value="$2"
  if ! printf "%s" "$value" | grep -Eq '^[A-Za-z0-9_]+$'; then
    die "$name may only contain letters, numbers and underscores: $value"
  fi
}

require_project_root() {
  [ -f "$APP_DIR/server.js" ] || die "server.js not found. Run this script from the project directory or set APP_DIR=/path/to/project"
  [ -f "$APP_DIR/package.json" ] || die "package.json not found. Run this script from the project directory or set APP_DIR=/path/to/project"
}

install_base_packages() {
  log "1/7 Installing system packages"
  $SUDO env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get update
  $SUDO env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y ca-certificates curl gnupg git nginx mysql-server build-essential openssl
}

ensure_app_user() {
  if ! id -u "$APP_USER" >/dev/null 2>&1; then
    $SUDO useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
  fi

  if [ -z "$APP_GROUP" ]; then
    APP_GROUP="$(id -gn "$APP_USER")"
  fi
}

install_node() {
  local major="0"
  if command -v node >/dev/null 2>&1; then
    major="$(node -v | sed 's/^v//' | cut -d. -f1)"
  fi

  if [ "${major:-0}" -ge 20 ] 2>/dev/null; then
    log "2/7 Node.js is already installed: $(node -v)"
    return
  fi

  log "2/7 Installing Node.js 20"
  if [ -n "$SUDO" ]; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a bash -
  else
    curl -fsSL https://deb.nodesource.com/setup_20.x | env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a bash -
  fi
  $SUDO env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y nodejs
}

prepare_mysql() {
  log "3/7 Configuring MySQL"
  validate_identifier "DB_NAME" "$DB_NAME"
  validate_identifier "DB_USER" "$DB_USER"

  $SUDO systemctl enable --now mysql >/dev/null 2>&1 || true

  local db_password_escaped
  db_password_escaped="$(sql_escape "$DB_PASSWORD")"

  $SUDO mysql <<SQL
CREATE DATABASE IF NOT EXISTS \`$DB_NAME\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '$DB_USER'@'localhost' IDENTIFIED BY '$db_password_escaped';
ALTER USER '$DB_USER'@'localhost' IDENTIFIED BY '$db_password_escaped';
GRANT ALL PRIVILEGES ON \`$DB_NAME\`.* TO '$DB_USER'@'localhost';
GRANT CREATE ON *.* TO '$DB_USER'@'localhost';
FLUSH PRIVILEGES;
SQL
}

write_env_file() {
  log "4/7 Writing .env"
  ADMIN_SESSION_SECRET="${ADMIN_SESSION_SECRET:-$(env_value ADMIN_SESSION_SECRET)}"
  ADMIN_SESSION_SECRET="${ADMIN_SESSION_SECRET:-$(random_token)}"

  cat > "$ENV_FILE" <<ENV
DB_HOST=localhost
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DB_NAME=$DB_NAME
PORT=$PORT
ADMIN_PASSWORD=$ADMIN_PASSWORD
ADMIN_SESSION_SECRET=$ADMIN_SESSION_SECRET
DB_CONNECTION_LIMIT=$DB_CONNECTION_LIMIT
DB_QUEUE_LIMIT=$DB_QUEUE_LIMIT
PUBLIC_CACHE_TTL_MS=$PUBLIC_CACHE_TTL_MS
PAGE_VIEW_BATCH_SIZE=$PAGE_VIEW_BATCH_SIZE
PAGE_VIEW_FLUSH_INTERVAL_MS=$PAGE_VIEW_FLUSH_INTERVAL_MS
ENV

  chmod 600 "$ENV_FILE"
}

install_app_dependencies() {
  log "5/7 Installing app dependencies"
  $SUDO chown -R "$APP_USER:$APP_GROUP" "$APP_DIR"

  local app_dir_q
  app_dir_q="$(shell_quote "$APP_DIR")"

  if [ -f "$APP_DIR/package-lock.json" ]; then
    run_as_app_user "cd $app_dir_q && npm ci --omit=dev"
  else
    run_as_app_user "cd $app_dir_q && npm install --omit=dev"
  fi
}

write_systemd_service() {
  log "6/7 Configuring systemd"
  $SUDO tee "/etc/systemd/system/${SERVICE_NAME}.service" >/dev/null <<SERVICE
[Unit]
Description=Codex Novel Express App
After=network.target mysql.service

[Service]
Type=simple
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node --env-file=.env server.js
Restart=always
RestartSec=5
User=$APP_USER
Group=$APP_GROUP
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
SERVICE

  $SUDO systemctl daemon-reload
  $SUDO systemctl enable --now "$SERVICE_NAME"
  $SUDO systemctl restart "$SERVICE_NAME"
}

write_nginx_site() {
  log "7/7 Configuring Nginx"
  local server_name listen_line primary_domain host_ip brotli_config
  primary_domain="$(printf "%s" "$DOMAIN" | awk '{print $1}')"
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  brotli_config=""
  if nginx -V 2>&1 | grep -qi brotli; then
    brotli_config=$'    brotli on;\n    brotli_comp_level 5;\n    brotli_types text/plain text/css application/javascript application/json application/xml image/svg+xml;'
  fi

  if [ -n "$DOMAIN" ]; then
    server_name="$DOMAIN"
    listen_line="listen 80;"
  else
    server_name="${host_ip:-_}"
    listen_line="listen 80;"
  fi

  $SUDO tee "/etc/nginx/sites-available/${SERVICE_NAME}" >/dev/null <<NGINX
server {
    $listen_line
    server_name $server_name;

    client_max_body_size 800m;

    gzip on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_vary on;
    gzip_types text/plain text/css application/javascript application/json application/xml image/svg+xml;
$brotli_config

    location ~* ^/(css|js|favicon.ico) {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_hide_header Cache-Control;
        proxy_hide_header Expires;
        expires 7d;
    }

    location / {
        proxy_pass http://127.0.0.1:$PORT;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
NGINX

  $SUDO ln -sfn "/etc/nginx/sites-available/${SERVICE_NAME}" "/etc/nginx/sites-enabled/${SERVICE_NAME}"
  $SUDO nginx -t
  $SUDO systemctl enable --now nginx >/dev/null 2>&1 || true
  $SUDO systemctl reload nginx

  if command -v ufw >/dev/null 2>&1 && $SUDO ufw status | grep -qw active; then
    $SUDO ufw allow 'Nginx Full' >/dev/null || true
  fi

  if [ "$ENABLE_SSL" = "1" ]; then
    [ -n "$DOMAIN" ] || die "DOMAIN=example.com is required when ENABLE_SSL=1"
    $SUDO env DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=a apt-get install -y certbot python3-certbot-nginx

    local domain_args=()
    for name in $DOMAIN; do
      domain_args+=("-d" "$name")
    done

    if [ -n "${EMAIL:-}" ]; then
      $SUDO certbot --nginx --non-interactive --agree-tos --redirect --email "$EMAIL" "${domain_args[@]}"
    else
      $SUDO certbot --nginx --non-interactive --agree-tos --redirect --register-unsafely-without-email "${domain_args[@]}"
    fi
  fi
}

health_check() {
  log "Checking service health"
  local app_ready=0
  for _ in $(seq 1 30); do
    if $SUDO systemctl is-active --quiet "$SERVICE_NAME" &&
      curl -fsS -o /dev/null "http://127.0.0.1:$PORT/healthz"; then
      app_ready=1
      break
    fi
    sleep 1
  done

  if [ "$app_ready" != "1" ]; then
    $SUDO journalctl -u "$SERVICE_NAME" -n 120 --no-pager
    die "Local app check failed: http://127.0.0.1:$PORT/healthz"
  fi

  local primary_domain
  if [ -n "$DOMAIN" ]; then
    primary_domain="$(printf "%s" "$DOMAIN" | awk '{print $1}')"
  else
    primary_domain="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [ -n "$primary_domain" ]; then
    curl -fsS -H "Host: $primary_domain" -o /dev/null "http://127.0.0.1/healthz" || die "Nginx proxy check failed"
  else
    curl -fsS -o /dev/null "http://127.0.0.1/healthz" || die "Nginx proxy check failed"
  fi
}

print_result() {
  local site_url admin_url host_ip
  if [ -n "$DOMAIN" ]; then
    site_url="http://$(printf "%s" "$DOMAIN" | awk '{print $1}')/"
  else
    host_ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
    site_url="http://${host_ip:-SERVER_IP}/"
  fi
  if [ "$ENABLE_SSL" = "1" ] && [ -n "$DOMAIN" ]; then
    site_url="https://$(printf "%s" "$DOMAIN" | awk '{print $1}')/"
  fi
  admin_url="${site_url%/}/admin/login"

  cat <<RESULT

Deploy complete

Site: $site_url
Admin: $admin_url
Admin password: $ADMIN_PASSWORD

Useful commands:
  sudo systemctl status $SERVICE_NAME
  sudo journalctl -u $SERVICE_NAME -f
  sudo systemctl restart $SERVICE_NAME

Config file:
  $ENV_FILE
Deploy log:
  $LOG_FILE
RESULT
}

main() {
  require_project_root

  DB_PASSWORD="${DB_PASSWORD:-$(env_value DB_PASSWORD)}"
  DB_PASSWORD="${DB_PASSWORD:-$(random_token)}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(env_value ADMIN_PASSWORD)}"
  ADMIN_PASSWORD="${ADMIN_PASSWORD:-$(random_token)}"

  install_base_packages
  ensure_app_user
  install_node
  prepare_mysql
  write_env_file
  install_app_dependencies
  write_systemd_service
  write_nginx_site
  health_check
  print_result
}

main "$@"
