// Sleep the given amount of milliseconds
export const sleep = async function (timeout: number): Promise<void> {
  await new Promise(function (resolve) {
    setTimeout(resolve, timeout)
  })
}

export const second = 1000
