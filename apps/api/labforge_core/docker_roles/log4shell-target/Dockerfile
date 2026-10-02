# CVE-2021-44228 (Log4Shell) lab target. Intentionally vulnerable: do not
# reuse this image or Log4j version outside an isolated LabForge lab network.
#
# The JDK is downloaded from Adoptium's own release archive and pinned to
# 8u181 (before the 8u191 change that disabled remote JNDI class loading by
# default, which would otherwise make the lab inert). It is fetched as a
# tarball rather than a guessed base-image tag, matching the same pinned
# build the Vagrant/VirtualBox path uses (provisioners/scripts/cve-2021-44228.sh),
# so both providers run the same, real target.
FROM debian:bookworm-slim

LABEL org.opencontainers.image.title="labforge log4shell-target" \
      org.opencontainers.image.description="CVE-2021-44228 vulnerable Log4j 2.14.1 target, lab use only"

RUN apt-get update \
    && DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends wget unzip ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV JDK_URL=https://github.com/adoptium/temurin8-binaries/releases/download/jdk8u181-b13/OpenJDK8U-jdk_x64_linux_8u181b13.tar.gz
RUN mkdir -p /opt/jdk8u181 \
    && wget -q "${JDK_URL}" -O /tmp/jdk8u181.tar.gz \
    && tar -xzf /tmp/jdk8u181.tar.gz -C /opt/jdk8u181 --strip-components=1 \
    && rm -f /tmp/jdk8u181.tar.gz
ENV JAVA_HOME=/opt/jdk8u181
ENV PATH="${JAVA_HOME}/bin:${PATH}"

RUN useradd -m -s /usr/sbin/nologin log4shell
WORKDIR /opt/log4shell

# Pin to the Log4j build Log4Shell was disclosed against.
RUN wget -q https://archive.apache.org/dist/logging/log4j/2.14.1/apache-log4j-2.14.1-bin.zip -O log4j.zip \
    && unzip -q log4j.zip \
    && mv apache-log4j-2.14.1-bin/log4j-core-2.14.1.jar . \
    && mv apache-log4j-2.14.1-bin/log4j-api-2.14.1.jar . \
    && rm -rf log4j.zip apache-log4j-2.14.1-bin

COPY VulnApp.java .
RUN javac -cp "log4j-core-2.14.1.jar:log4j-api-2.14.1.jar" VulnApp.java \
    && chown -R log4shell:log4shell /opt/log4shell /opt/jdk8u181

USER log4shell
EXPOSE 8080
HEALTHCHECK --interval=5s --retries=30 --start-period=15s \
    CMD ["sh", "-c", "exec 3<>/dev/tcp/127.0.0.1/8080 && exec 3<&-"]
CMD ["java", "-cp", ".:log4j-core-2.14.1.jar:log4j-api-2.14.1.jar", "VulnApp"]
