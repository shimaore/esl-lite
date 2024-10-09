#!/bin/bash

set -e

podman build -t uut -f test-reconnect/Dockerfile .
podman run -d --network host --name uut --replace uut \
  /usr/bin/node --test --abort-on-uncaught-exception --report-uncaught-exception --test-timeout 120000 --test-reporter spec --test-concurrency 1 --test-name-pattern '.*' build/test-reconnect/*.test.js &

for attempt in $(seq 1 60); do
  echo "Attempt $attempt"
  podman run -d --network host --name fs-uut --replace uut \
    /usr/bin/freeswitch -nf -c -nosql -nonat -nocal -nort \
    -conf /opt/test -log /dev/shm -db /dev/shm -cfgname server.xml
  podman ps
  # sleep 25
  # podman exec fs-uut fs_cli -P 8022 -x shutdown
  # sleep 10
  sleep 4
  podman kill fs-uut
  podman logs fs-uut
done

podman logs --follow uut

wait
