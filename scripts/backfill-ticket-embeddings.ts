import { backfillTicketEmbeddings } from '@repo/ai'

backfillTicketEmbeddings()
  .then((result) => {
    console.log(result)
    process.exit(0)
  })
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
