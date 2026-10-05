export PATH=/opt/homebrew/opt/postgresql@15/bin:$PATH LC_ALL=en_US.UTF-8
export PGHOST=localhost PGPORT=54332 PGUSER=postgres
O=/Users/wmadden/Projects/prisma/orm/.claude/worktrees/gagarin-30475
Q=$O/wip/qa
BIN=$O/packages/1-framework/3-tooling/cli/dist/bin.mjs
URL=postgresql://postgres@localhost:54332
p() { echo "\$ prisma $*"; node $BIN "$@" --format human --no-color 2>&1 | grep -v 'agent skills' | sed -e 's/[[:space:]]*$//'; echo "[exit ${pipestatus[1]}]"; echo; }
fresh_db() { dropdb --if-exists $1 >/dev/null 2>&1; if [ -n "$2" ]; then createdb -T $2 $1; else createdb $1; fi; }
reset_mig() { rm -rf $Q/scratch/migrations; cp -R $Q/migrations.pristine $Q/scratch/migrations; }
