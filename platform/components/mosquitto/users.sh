#!/usr/bin/env bash
# MQTT users for Mosquitto: one random password per user, kept across runs, hashed into the broker's
# password file (secret mosquitto/mosquitto-users), plus each consumer's copy:
#   espresense     ESPresense nodes       secret mosquitto/mqtt-espresense (username, password: enter on each node)
#   presence       apps/presence          secret presence/presence-mqtt (MQTT_USERNAME, MQTT_PASSWORD)
#   homeassistant  apps/homeassistant     secret homeassistant/homeassistant-mqtt (username, password: enter in
#                                         Home Assistant's MQTT integration)
#   ruuvigateway   Ruuvi Gateway (cabin)  secret mosquitto/mqtt-ruuvigateway (username, password: enter in the
#                                         gateway's MQTT settings)
#   ruuvi          apps/ruuvi             secret ruuvi/ruuvi-mqtt (MQTT_USERNAME, MQTT_PASSWORD)
#   ./platform/components/mosquitto/users.sh                    create missing users, keep the rest
#   ./platform/components/mosquitto/users.sh --rotate presence  new password for one user
# Needs kubectl and podman (mosquitto_passwd from the broker's image). Topic access: acl.
set -euo pipefail

here=$(cd "$(dirname "$0")" && pwd)
image=docker.io/library/eclipse-mosquitto:2.0.22
rotate=
if [[ ${1:-} == --rotate ]]; then
	rotate=${2:?usage: users.sh [--rotate espresense|presence|homeassistant|ruuvigateway|ruuvi]}
	[[ $rotate =~ ^(espresense|presence|homeassistant|ruuvigateway|ruuvi)$ ]] || { echo "unknown user $rotate" >&2; exit 1; }
fi

new_password() { python3 -c 'import secrets; print(secrets.token_urlsafe(24))'; }
existing() { kubectl -n "$1" get secret "$2" -o jsonpath="{.data.$3}" 2>/dev/null | base64 -d || true; }

kubectl apply -f "$here/namespace.yaml" -f "$here/../../../apps/presence/deploy/namespace.yaml" \
	-f "$here/../../../apps/homeassistant/deploy/namespace.yaml" -f "$here/../../../apps/ruuvi/deploy/namespace.yaml" >/dev/null

ESP=$(existing mosquitto mqtt-espresense password)
PRES=$(existing presence presence-mqtt MQTT_PASSWORD)
HASS=$(existing homeassistant homeassistant-mqtt password)
RGW=$(existing mosquitto mqtt-ruuvigateway password)
RUUVI=$(existing ruuvi ruuvi-mqtt MQTT_PASSWORD)
[[ -z $ESP || $rotate == espresense ]] && ESP=$(new_password)
[[ -z $PRES || $rotate == presence ]] && PRES=$(new_password)
[[ -z $HASS || $rotate == homeassistant ]] && HASS=$(new_password)
[[ -z $RGW || $rotate == ruuvigateway ]] && RGW=$(new_password)
[[ -z $RUUVI || $rotate == ruuvi ]] && RUUVI=$(new_password)
export ESP PRES HASS RGW RUUVI

# Passwords reach the container through the environment, not the command line.
hashed=$(podman run --rm -e ESP -e PRES -e HASS -e RGW -e RUUVI "$image" sh -c \
	'printf "espresense:%s\npresence:%s\nhomeassistant:%s\nruuvigateway:%s\nruuvi:%s\n" "$ESP" "$PRES" "$HASS" "$RGW" "$RUUVI" > /tmp/p && mosquitto_passwd -U /tmp/p && cat /tmp/p')

apply() { kubectl create secret generic "$@" --dry-run=client -o yaml | kubectl apply -f - >/dev/null; }
apply -n mosquitto mosquitto-users --from-literal=passwords="$hashed"
apply -n mosquitto mqtt-espresense --from-literal=username=espresense --from-literal=password="$ESP"
apply -n presence presence-mqtt --from-literal=MQTT_USERNAME=presence --from-literal=MQTT_PASSWORD="$PRES"
apply -n homeassistant homeassistant-mqtt --from-literal=username=homeassistant --from-literal=password="$HASS"
apply -n mosquitto mqtt-ruuvigateway --from-literal=username=ruuvigateway --from-literal=password="$RGW"
apply -n ruuvi ruuvi-mqtt --from-literal=MQTT_USERNAME=ruuvi --from-literal=MQTT_PASSWORD="$RUUVI"

# The broker reads the password file at start; presence and ruuvi connect with their copy at start.
kubectl -n mosquitto rollout restart deploy/mosquitto 2>/dev/null || true
[[ $rotate == presence ]] && kubectl -n presence rollout restart deploy/presence
[[ $rotate == ruuvi ]] && kubectl -n ruuvi rollout restart deploy/ruuvi
echo "users written. ESPresense node login: espresense / \$(kubectl -n mosquitto get secret mqtt-espresense -o jsonpath='{.data.password}' | base64 -d)"
echo "Home Assistant MQTT login: homeassistant / \$(kubectl -n homeassistant get secret homeassistant-mqtt -o jsonpath='{.data.password}' | base64 -d)"
echo "Ruuvi Gateway MQTT login: ruuvigateway / \$(kubectl -n mosquitto get secret mqtt-ruuvigateway -o jsonpath='{.data.password}' | base64 -d)"
